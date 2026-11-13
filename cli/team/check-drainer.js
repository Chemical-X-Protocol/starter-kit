/**
 * The check queue's single drain worker. One row in check_drainer is the lease: it is taken in a
 * BEGIN IMMEDIATE transaction, kept alive by a heartbeat, and taken over when the heartbeat is stale
 * or the holder's pid is dead. The worker is detached and unref'd (no daemon): it runs due jobs one
 * at a time through the injected executor, recovers jobs a dead worker left running, and exits
 * after an idle period. Clock, executor, delivery and fingerprint are injected so specs never wait or spawn.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isPidAlive, withImmediateTransaction } from './team-db-transaction.js';
import { rowToJob, treeFingerprint } from './check-queue.js';

export const LEASE_STALE_MS = 30_000;
export const HEARTBEAT_MS = 5_000;
export const IDLE_EXIT_MS = 60_000;
export const MAX_ATTEMPTS = 2;
const POLL_MS = 1_000;
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

const defaultSpawn = (cwd) => {
  const child = spawn(process.execPath, [CLI_ENTRY, 'team', 'check', 'drain'], { cwd, detached: true, stdio: 'ignore', env: { ...process.env, CHEMX_DRAIN: '1' } });
  child.on('error', () => {});
  child.unref();
};

/** Starts a detached worker unless a live one holds the lease. Returns whether it spawned. */
export const ensureDrainer = (db, { cwd, now = Date.now(), isAlive = isPidAlive, spawnWorker = defaultSpawn } = {}) => {
  if (drainerStatus(db, now, isAlive).running) return false;
  spawnWorker(cwd);
  return true;
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

const executeJob = async (executor, job) => {
  const started = Date.now();
  try {
    return await executor(job);
  } catch (error) {
    return { status: 'inconclusive', reason: 'executor-error', summaryLine: String(error?.message || error), faults: [], errorCount: 0, durationMs: Date.now() - started };
  }
};

const runOne = async (db, job, deps) => {
  const { executor, deliver, clock, fingerprint, token } = deps;
  const startFp = fingerprint(job.cwd);
  db.prepare('UPDATE check_jobs SET tree_fp = ? WHERE id = ?').run(startFp, job.id);
  const timer = setInterval(() => heartbeat(db, token, clock()), HEARTBEAT_MS);
  timer.unref?.();
  let result;
  try {
    result = await executeJob(executor, job);
  } finally {
    clearInterval(timer);
  }
  const finishFp = fingerprint(job.cwd);
  const finished = { ...result, treeFpAtFinish: finishFp, stale: finishFp !== startFp };
  const isRecorded = finishJob(db, job, finished, clock());
  if (isRecorded) deliver(db, { ...job, tree_fp: startFp }, finished);
};

const deliverFailed = (db, failedJobs, deliver) => {
  for (const job of failedJobs) deliver(db, job, job.result);
};

/**
 * Runs the drain loop. Returns { exited: 'lease-held' | 'idle' | 'lease-lost' | 'once', ran }.
 * Options: executor(job) -> result, deliver(db, job, result), clock, sleep, fingerprint, pid, token, isAlive, idleExitMs, once.
 */
export const runDrainer = async (db, options = {}) => {
  const { executor, deliver, clock = Date.now, sleep = delay, fingerprint = treeFingerprint, pid = process.pid, token = randomUUID(), isAlive = isPidAlive, idleExitMs = IDLE_EXIT_MS, once = false } = options;
  const deps = { executor, deliver, clock, fingerprint, token };
  const hasLease = () => acquireLease(db, { pid, token, now: clock(), isAlive });
  if (!hasLease()) return { exited: 'lease-held', ran: 0 };
  deliverFailed(db, recoverOrphans(db, clock()), deliver);
  let ran = 0;
  let idleSince = clock();
  for (;;) {
    const job = claimNext(db, { token, pid, now: clock() });
    if (job) {
      await runOne(db, job, deps);
      ran += 1;
      idleSince = clock();
      const isStillMine = heartbeat(db, token, clock());
      if (!isStillMine) return { exited: 'lease-lost', ran };
      continue;
    }
    if (once) {
      releaseLease(db, token);
      return { exited: 'once', ran };
    }
    const isIdleLongEnough = clock() - idleSince >= idleExitMs;
    if (!isIdleLongEnough) {
      const isLeaseKept = heartbeat(db, token, clock());
      if (!isLeaseKept) return { exited: 'lease-lost', ran };
      await sleep(POLL_MS);
      continue;
    }
    // Close the enqueue race: an enqueuer that saw a live lease did not spawn, so look once more after releasing it.
    releaseLease(db, token);
    if (!hasQueued(db)) return { exited: 'idle', ran };
    if (!hasLease()) return { exited: 'lease-held', ran };
    idleSince = clock();
  }
};
