/**
 * The check queue's single drain worker. One row in check_drainer is the lease: it is taken in a
 * BEGIN IMMEDIATE transaction, kept alive by a heartbeat, and taken over when the heartbeat is stale
 * or the holder's pid is dead. The worker is detached and unref'd (no daemon): it runs due jobs one
 * at a time through the injected executor, recovers jobs a dead worker left running, and exits
 * after an idle period. Clock, executor, delivery and fingerprint are injected so specs never wait or spawn.
 *
 * Failure handling: while a job runs, a watcher heartbeats the lease and polls the row, and aborts the executor
 * (which kills the check's process tree) when the job was cancelled or this worker lost the lease. A busy db never
 * kills the worker. Delivery never throws into the loop: a result that could not be delivered stays un-notified,
 * and the worker re-delivers every finished-but-unnotified job when it starts and again before it goes idle.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isPidAlive, isSqliteBusyError, withImmediateTransaction } from './team-db-transaction.js';
import { rowToJob } from './check-queue.js';
import { treeFingerprint } from './check-fingerprint.js';
import { redeliverUnnotified } from './check-delivery.js';

export const LEASE_STALE_MS = 30_000;
export const HEARTBEAT_MS = 5_000;
export const IDLE_EXIT_MS = 60_000;
export const MAX_ATTEMPTS = 2;
const POLL_MS = 1_000;
const LEASE_LOST = 'lease-lost';
const CANCELLED = 'cancelled';
const CANCEL_POLL_MS = 1_000;
const MAX_LOG_BYTES = 1_000_000;
const CLI_ENTRY = fileURLToPath(new URL('../index.js', import.meta.url));

export const acquireLease = (db, { pid, token, now = Date.now(), isAlive = isPidAlive }) => withImmediateTransaction(db, () => {
  const row = db.prepare('SELECT pid, token, heartbeat FROM check_drainer WHERE id = 1').get();
  const isMine = Boolean(row) && row.token === token;
  const isStale = Boolean(row) && (now - row.heartbeat >= LEASE_STALE_MS || !isAlive(row.pid));
  const isFree = !row || isMine || isStale;
  if (!isFree) return false;
  db.prepare('INSERT OR REPLACE INTO check_drainer (id, pid, token, heartbeat, started_at) VALUES (1, ?, ?, ?, ?)').run(pid, token, now, now);
  return true;
});

/** false when this worker no longer holds the lease (another took over). */
export const heartbeat = (db, token, now = Date.now()) => db.prepare('UPDATE check_drainer SET heartbeat = ? WHERE id = 1 AND token = ?').run(now, token).changes > 0;

export const releaseLease = (db, token) => {
  db.prepare('DELETE FROM check_drainer WHERE id = 1 AND token = ?').run(token);
};

export const drainerStatus = (db, now = Date.now(), isAlive = isPidAlive) => {
  const row = db.prepare('SELECT pid, heartbeat, started_at FROM check_drainer WHERE id = 1').get();
  if (!row) return { running: false };
  const ageMs = now - row.heartbeat;
  return { running: ageMs < LEASE_STALE_MS && isAlive(row.pid), pid: row.pid, heartbeatAgeMs: ageMs, startedAt: row.started_at };
};

/** Where the detached worker's stdout and stderr go, so a crash at startup leaves a trace. */
export const drainLogPath = (env = process.env) => env.CHEMX_CHECK_DRAIN_LOG || join(tmpdir(), `chemx-check-drainer-${process.getuid?.() ?? 'user'}.log`);

const openDrainLog = (path) => {
  try {
    const isOversize = statSync(path, { throwIfNoEntry: false })?.size > MAX_LOG_BYTES;
    return openSync(path, isOversize ? 'w' : 'a');
  } catch {
    // chemx-allow: best-effort an unwritable log only costs the trace, not the worker
    return 'ignore';
  }
};

/** Spawns the detached worker. A spawn that fails (now or on the next tick) is reported on stderr, never swallowed. */
const defaultSpawn = (cwd) => {
  const logPath = drainLogPath();
  const log = openDrainLog(logPath);
  const child = spawn(process.execPath, [CLI_ENTRY, 'team', 'check', 'drain'], { cwd, detached: true, stdio: ['ignore', log, log], env: { ...process.env, CHEMX_DRAIN: '1' } });
  child.on('error', (error) => process.stderr.write(`chemx: the check drain worker could not start (${error.message}). Run \`chemx team check drain\` yourself; worker log: ${logPath}\n`));
  child.unref();
  const isFileDescriptor = typeof log === 'number';
  if (isFileDescriptor) closeSync(log);
};

/**
 * Starts a detached worker unless a live one holds the lease. Returns { spawned, error }: `error` is why a spawn
 * threw. Callers run it for every enqueue that is not answered from cache, so a dead or crashed worker is revived
 * even when the new request coalesced into, or joined, a job nobody is working on.
 */
export const ensureDrainer = (db, { cwd, now = Date.now(), isAlive = isPidAlive, spawnWorker = defaultSpawn } = {}) => {
  if (drainerStatus(db, now, isAlive).running) return { spawned: false, error: null };
  try {
    spawnWorker(cwd);
    return { spawned: true, error: null };
  } catch (error) {
    return { spawned: false, error: String(error?.message || error) };
  }
};

/** Jobs left 'running' by a dead worker: requeue once, then fail as inconclusive. Returns the failed ones. */
export const recoverOrphans = (db, now = Date.now()) => withImmediateTransaction(db, () => {
  const orphans = db.prepare("SELECT * FROM check_jobs WHERE status = 'running'").all();
  const failed = [];
  for (const row of orphans) {
    const isExhausted = row.attempts >= MAX_ATTEMPTS;
    if (!isExhausted) {
      db.prepare("UPDATE check_jobs SET status = 'queued', worker_token = NULL, worker_pid = 0 WHERE id = ?").run(row.id);
      continue;
    }
    const result = { status: 'inconclusive', reason: 'worker-crash', summaryLine: 'the drain worker died twice while running this check', faults: [], errorCount: 0 };
    db.prepare("UPDATE check_jobs SET status = 'failed', finished_at = ?, result = ? WHERE id = ?").run(now, JSON.stringify(result), row.id);
    failed.push(rowToJob({ ...row, status: 'failed', result: JSON.stringify(result) }));
  }
  return failed;
});

const claimNext = (db, { token, pid, now }) => withImmediateTransaction(db, () => {
  const row = db.prepare("SELECT * FROM check_jobs WHERE status = 'queued' AND run_at <= ? ORDER BY priority, id LIMIT 1").get(now);
  if (!row) return null;
  db.prepare("UPDATE check_jobs SET status = 'running', started_at = ?, worker_token = ?, worker_pid = ?, attempts = attempts + 1 WHERE id = ?").run(now, token, pid, row.id);
  return rowToJob(db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(row.id));
});

/** Records the result unless the job was cancelled meanwhile; returns whether it was recorded. */
const finishJob = (db, job, result, now) => {
  const status = result.status === 'pass' ? 'done' : 'failed';
  const info = db.prepare("UPDATE check_jobs SET status = ?, finished_at = ?, result = ? WHERE id = ? AND status = 'running' AND worker_token = ?").run(status, now, JSON.stringify(result), job.id, job.worker_token);
  return info.changes > 0;
};

const hasQueued = (db) => db.prepare("SELECT 1 AS found FROM check_jobs WHERE status = 'queued' LIMIT 1").get() !== undefined;

const isJobStillMine = (db, job) => db.prepare("SELECT 1 AS found FROM check_jobs WHERE id = ? AND status = 'running' AND worker_token = ?").get(job.id, job.worker_token) !== undefined;

/** A heartbeat that treats a busy db as "still alive, try again": only a lost lease (false) or a real error says otherwise. */
const beat = (db, token, now) => {
  try {
    return heartbeat(db, token, now);
  } catch (error) {
    if (isSqliteBusyError(error)) return true;
    throw error;
  }
};

const stillMine = (db, job) => {
  try {
    return isJobStillMine(db, job);
  } catch (error) {
    if (isSqliteBusyError(error)) return true;
    throw error;
  }
};

/**
 * While a job runs: heartbeat the lease, and poll the row. A cancelled job (the row left 'running') or a lost lease
 * aborts the controller, which stops the executor's process tree. Timer errors never escape (an uncaught one would
 * kill the worker mid-job and leave its child running): they are kept in `failures` and the watcher keeps going.
 */
const watchJob = (db, job, { token, clock, controller, heartbeatMs, cancelPollMs }) => {
  const failures = [];
  const guarded = (action) => () => {
    try {
      action();
    } catch (error) {
      failures.push(String(error?.message || error));
    }
  };
  const checkLease = () => {
    const hasLease = beat(db, token, clock());
    if (!hasLease) controller.abort(LEASE_LOST);
  };
  const checkJob = () => {
    const isMine = stillMine(db, job);
    if (!isMine) controller.abort(CANCELLED);
  };
  const beatTimer = setInterval(guarded(checkLease), heartbeatMs);
  const cancelTimer = setInterval(guarded(checkJob), cancelPollMs);
  // Not unref'd: while a check runs, these timers are what keeps the worker alive and able to abort it. stop() clears them.
  return { failures, stop: () => { clearInterval(beatTimer); clearInterval(cancelTimer); } };
};

const executeJob = async (executor, job, signal) => {
  const started = Date.now();
  try {
    return await executor(job, { signal });
  } catch (error) {
    const wasAborted = signal.aborted;
    const summaryLine = wasAborted ? 'the check was cancelled or its worker lost the lease' : String(error?.message || error);
    return { status: 'inconclusive', reason: wasAborted ? 'aborted' : 'executor-error', summaryLine, faults: [], errorCount: 0, durationMs: Date.now() - started };
  }
};

/** Delivery that never throws into the worker: whatever fails stays un-notified for the next sweep. */
const deliverSafely = (db, job, result, deliver) => {
  try {
    deliver(db, job, result);
    return true;
  } catch {
    // chemx-allow: best-effort the requesters stay un-notified and the next sweep redelivers
    return false;
  }
};

const runOne = async (db, job, deps) => {
  const { executor, deliver, clock, fingerprint, token, heartbeatMs, cancelPollMs } = deps;
  const controller = new AbortController();
  const watcher = watchJob(db, job, { token, clock, controller, heartbeatMs, cancelPollMs });
  let startDeep = '';
  let result;
  try {
    const startFp = fingerprint(job.cwd);
    startDeep = fingerprint(job.cwd, { deep: true });
    db.prepare('UPDATE check_jobs SET tree_fp = ?, tree_fp_deep = ? WHERE id = ?').run(startFp, startDeep, job.id);
    const isCancelledAlready = !stillMine(db, job);
    if (isCancelledAlready) controller.abort(CANCELLED);
    result = controller.signal.aborted ? { status: 'inconclusive', reason: 'aborted', faults: [], errorCount: 0 } : await executeJob(executor, job, controller.signal);
  } finally {
    watcher.stop();
  }
  // A worker that lost the lease records nothing: the job is still 'running', so the new worker's recoverOrphans requeues it.
  const hasLostLease = controller.signal.reason === LEASE_LOST;
  if (hasLostLease) return;
  const finishDeep = fingerprint(job.cwd, { deep: true });
  const finished = { ...result, treeFpAtFinish: finishDeep, stale: finishDeep !== startDeep };
  const isRecorded = finishJob(db, job, finished, clock());
  if (isRecorded) deliverSafely(db, { ...job, tree_fp_deep: startDeep }, finished, deliver);
};

/**
 * Runs the drain loop. Returns { exited: 'lease-held' | 'idle' | 'lease-lost' | 'once', ran }.
 * Options: executor(job, { signal }) -> result, deliver(db, job, result), clock, sleep, fingerprint(cwd, { deep }), pid, token,
 * isAlive, idleExitMs, once, heartbeatMs, cancelPollMs.
 */
export const runDrainer = async (db, options = {}) => {
  const { executor, deliver, clock = Date.now, sleep = delay, fingerprint = treeFingerprint, pid = process.pid, token = randomUUID(), isAlive = isPidAlive, idleExitMs = IDLE_EXIT_MS, once = false, heartbeatMs = HEARTBEAT_MS, cancelPollMs = CANCEL_POLL_MS } = options;
  const deps = { executor, deliver, clock, fingerprint, token, heartbeatMs, cancelPollMs };
  const hasLease = () => acquireLease(db, { pid, token, now: clock(), isAlive });
  if (!hasLease()) return { exited: 'lease-held', ran: 0 };
  try {
    return await drainLoop(db, { deps, options: { sleep, idleExitMs, once, pid }, hasLease });
  } finally {
    // Whatever ended the loop (an error included), never leave a lease nobody works under.
    releaseLeaseSafely(db, token);
  }
};

const releaseLeaseSafely = (db, token) => {
  try {
    releaseLease(db, token);
  } catch (error) {
    // A busy db leaves the lease to go stale (LEASE_STALE_MS); anything else is a real fault.
    if (!isSqliteBusyError(error)) throw error;
  }
};

const drainLoop = async (db, { deps, options, hasLease }) => {
  const { clock, token, deliver } = deps;
  const { sleep, idleExitMs, once, pid } = options;
  recoverOrphans(db, clock());
  redeliverUnnotified(db, deliver);
  let ran = 0;
  let idleSince = clock();
  for (;;) {
    const job = claimNext(db, { token, pid, now: clock() });
    if (job) {
      await runOne(db, job, deps);
      ran += 1;
      idleSince = clock();
      const isStillMine = beat(db, token, clock());
      if (!isStillMine) return { exited: 'lease-lost', ran };
      continue;
    }
    if (once) return { exited: 'once', ran };
    const isIdleLongEnough = clock() - idleSince >= idleExitMs;
    if (!isIdleLongEnough) {
      const isLeaseKept = beat(db, token, clock());
      if (!isLeaseKept) return { exited: 'lease-lost', ran };
      await sleep(POLL_MS);
      continue;
    }
    redeliverUnnotified(db, deliver);
    // Close the enqueue race: an enqueuer that saw a live lease did not spawn, so look once more after releasing it.
    releaseLease(db, token);
    if (!hasQueued(db)) return { exited: 'idle', ran };
    if (!hasLease()) return { exited: 'lease-held', ran };
    idleSince = clock();
  }
};
