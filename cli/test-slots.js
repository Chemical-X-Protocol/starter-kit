// Cross-process test worker budget. Every `chemx test` run (CLI, MCP, verify) takes worker slots
// from lock files under os.tmpdir()/chemx-test-slots before it starts the runner, so concurrent
// runs from several agents never exceed the machine budget in total. A slot file holds the pid
// of the run that owns it, its handle, task and command when known, its start time and a
// heartbeat refreshed while held. A slot whose pid is dead, or whose heartbeat is older than the
// stale window (for example a reused pid), is reclaimed; a file without a heartbeat (written by
// an older chemx) is judged by its pid alone. A short mkdir mutex makes the scan-and-claim atomic
// across processes. Waiting runs leave a `wait-<pid>` file so the queue can be listed; the
// position it reports is informational and does not enforce first-come order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scheduleTimeout } from './timers.js';
import { readJsonOr } from './fs-json.js';

// Set in the runner's environment: a chemx test started by a spec inside a slot-holding run is
// already covered by its parent's slot, so it runs with one worker and never waits (no deadlock).
export const SLOT_OWNER_ENV = 'CHEMX_TEST_SLOT_OWNER';
export const SLOT_WAIT_TIMEOUT_CODE = 'CHEMX_SLOT_WAIT_TIMEOUT';
const MUTEX_STALE_MS = 2000;
const DEFAULT_POLL_MS = 200;
const DEFAULT_HEARTBEAT_MS = 10000;
const DEFAULT_STALE_MS = 60000;
const DEFAULT_STATUS_MS = 30000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60000;
const LONG_WAIT_MS = 60000;

export const defaultSlotsDir = (env = process.env) => env.CHEMX_TEST_SLOTS_DIR || path.join(os.tmpdir(), 'chemx-test-slots');

// CHEMX_TEST_CONCURRENCY when it is a positive integer, otherwise half the cores (at least 1).
export const resolveTestBudget = (env = process.env, cores = os.availableParallelism()) => {
  const fromEnv = Number(env.CHEMX_TEST_CONCURRENCY);
  const hasOverride = Number.isInteger(fromEnv) && fromEnv > 0;
  return hasOverride ? fromEnv : Math.max(1, Math.floor(cores / 2));
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The critical section only reads and writes a few small files, so a mutex older than
// MUTEX_STALE_MS belongs to a process that died inside it.
const withMutex = (dir, fn) => {
  const lock = path.join(dir, '.mutex');
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      const isOtherError = error.code !== 'EEXIST';
      if (isOtherError) throw error;
      const mtime = fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now();
      const isStale = Date.now() - mtime > MUTEX_STALE_MS;
      if (isStale) fs.rmSync(lock, { recursive: true, force: true });
      else sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
};

const readHolder = (file) => readJsonOr(file, null);

// A record counts as live when its pid exists and, if it carries a heartbeat, the heartbeat is
// newer than the stale window.
const isLive = (record, now, staleMs) => {
  const hasPid = Boolean(record) && Number.isInteger(record.pid);
  const hasHeartbeat = hasPid && typeof record.heartbeat === 'number';
  const isFresh = !hasHeartbeat || now - record.heartbeat <= staleMs;
  return hasPid && isFresh && isAlive(record.pid);
};

const identityOf = (options, env) => ({
  handle: options.handle ?? env.CHEMX_AGENT_ID ?? null,
  task: options.task ?? env.CHEMX_TASK_ID ?? null,
  command: String(options.command ?? process.argv.slice(2).join(' ')).slice(0, 200)
});

const describeHolder = (holder) => {
  const parts = [holder.handle || `pid ${holder.pid}`];
  const hasTask = Boolean(holder.task);
  const hasStart = typeof holder.since === 'number';
  if (hasTask) parts.push(`task ${holder.task}`);
  if (hasStart) parts.push(`for ${Math.max(0, Math.round((Date.now() - holder.since) / 1000))}s`);
  return parts.join(' ');
};

// Claims up to `want` free slots (indices below `budget`); returns the claimed files and the
// live records holding the rest.
const claimFreeSlots = (dir, budget, want, identity, staleMs) => withMutex(dir, () => {
  const taken = [];
  const holders = [];
  const now = Date.now();
  const token = randomUUID();
  for (let index = 0; index < budget && taken.length < want; index++) {
    const file = path.join(dir, `slot-${index}`);
    const holder = readHolder(file);
    if (isLive(holder, now, staleMs)) {
      holders.push(holder);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, since: now, heartbeat: now, ...identity }));
    taken.push({ file, token });
  }
  return { taken, holders };
});

const isOurs = (file, token) => {
  const record = readHolder(file);
  return record?.pid === process.pid && record?.token === token;
};

const holdSlots = (taken, budget, queuedMs, heartbeatMs) => {
  const beat = () => {
    for (const { file, token } of taken) {
      const record = readHolder(file);
      const isStillOurs = record?.pid === process.pid && record?.token === token;
      if (isStillOurs) fs.writeFileSync(file, JSON.stringify({ ...record, heartbeat: Date.now() }));
    }
  };
  const timer = setInterval(beat, heartbeatMs);
  timer.unref();
  const releaseSync = () => {
    clearInterval(timer);
    for (const { file, token } of taken) {
      if (isOurs(file, token)) fs.rmSync(file, { force: true });
    }
  };
  process.once('exit', releaseSync);
  const release = () => {
    process.removeListener('exit', releaseSync);
    releaseSync();
  };
  return { workers: taken.length, budget, queuedMs, nested: false, queued: false, release };
};

const waiterFile = (dir) => path.join(dir, `wait-${process.pid}`);

const writeWaiter = (dir, record) => fs.writeFileSync(waiterFile(dir), JSON.stringify(record));

const liveWaiters = (dir, now, staleMs) => {
  const names = fs.readdirSync(dir).filter((name) => name.startsWith('wait-'));
  const records = names.map((name) => readHolder(path.join(dir, name)));
  const live = records.filter((record) => isLive(record, now, staleMs));
  return live.sort((a, b) => a.since - b.since || a.pid - b.pid);
};

// Snapshot for `chemx test --slots`: who holds each slot, and who is queued.
export const listTestSlots = (options = {}) => {
  const env = options.env || process.env;
  const dir = options.dir || defaultSlotsDir(env);
  const budget = options.budget ?? resolveTestBudget(env);
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? Date.now();
  const hasDir = fs.existsSync(dir);
  if (!hasDir) return { dir, budget, holders: [], waiting: [] };
  const holders = [];
  for (let index = 0; index < budget; index++) {
    const record = readHolder(path.join(dir, `slot-${index}`));
    if (!record) continue;
    const state = isLive(record, now, staleMs) ? 'held' : 'stale';
    holders.push({ slot: index, state, pid: record.pid, handle: record.handle ?? null, task: record.task ?? null, command: record.command ?? null, ageMs: now - record.since, heartbeatAgeMs: typeof record.heartbeat === 'number' ? now - record.heartbeat : null });
  }
  const waiting = liveWaiters(dir, now, staleMs).map((record, index) => ({ position: index + 1, pid: record.pid, handle: record.handle ?? null, task: record.task ?? null, waitedMs: now - record.since }));
  return { dir, budget, holders, waiting };
};

// Plain-text rendering of listTestSlots; states only what the files say.
export const formatTestSlots = (snapshot) => {
  const held = snapshot.holders.filter((holder) => holder.state === 'held').length;
  const lines = [`chemx test slots: ${held} of ${snapshot.budget} held, ${snapshot.waiting.length} queued (${snapshot.dir})`];
  for (const holder of snapshot.holders) {
    const who = holder.handle || 'unknown handle';
    const task = holder.task ? ` task ${holder.task}` : ' no task recorded';
    const beat = holder.heartbeatAgeMs === null ? 'no heartbeat' : `heartbeat ${Math.round(holder.heartbeatAgeMs / 1000)}s ago`;
    lines.push(`  slot ${holder.slot} ${holder.state}: ${who},${task}, pid ${holder.pid}, age ${Math.round(holder.ageMs / 1000)}s, ${beat}`);
  }
  for (const waiter of snapshot.waiting) {
    lines.push(`  queued #${waiter.position}: ${waiter.handle || `pid ${waiter.pid}`}, waiting ${Math.round(waiter.waitedMs / 1000)}s`);
  }
  return `${lines.join('\n')}\n`;
};

const holderList = (holders) => [...new Set(holders.map(describeHolder))].join('; ');

const waitLine = (budget, holders, position, waitedMs) => `chemx test: waiting for a test slot (budget ${budget} worker(s), queue position about ${position}, waited ${Math.round(waitedMs / 1000)}s, held by ${holderList(holders)}; set CHEMX_TEST_CONCURRENCY to change)\n`;
const delay = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));

// Resolves to { workers, budget, queuedMs, nested, queued, release } once at least one slot is free.
// A run takes min(want, free slots) workers. While queued it reports itself through onWait once,
// then every statusMs (default 30s). Options:
//   waitTimeoutMs        give up after this long (default 10 min; 0 disables) with an error whose
//                        code is SLOT_WAIT_TIMEOUT_CODE and whose message names the holders
//   returnQueuedAfterMs  for hosts with a call timeout: after this long, resolve with
//                        { queued: true, position, holders, retryCommand, workers: 0 } instead
//                        of waiting; nothing is held and the caller must run retryCommand
//   onLongWait           called with { queuedMs, budget, holders } after a grant that waited 60s+
export const acquireTestSlots = async (options = {}) => {
  const env = options.env || process.env;
  const budget = options.budget ?? resolveTestBudget(env);
  const want = Math.max(1, Math.min(options.want ?? budget, budget));
  const isNested = Boolean(env[SLOT_OWNER_ENV]);
  if (isNested) return { workers: 1, budget, queuedMs: 0, nested: true, queued: false, release: () => {} };
  const dir = options.dir || defaultSlotsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const onWait = options.onWait || ((line) => process.stderr.write(line));
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const statusMs = options.statusMs ?? DEFAULT_STATUS_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const identity = identityOf(options, env);
  const start = Date.now();
  let lastStatus = null;
  let lastBeat = 0;
  let lastHolders = [];
  const clearWaiter = () => fs.rmSync(waiterFile(dir), { force: true });
  process.once('exit', clearWaiter);
  const finish = () => {
    process.removeListener('exit', clearWaiter);
    clearWaiter();
  };
  try {
    for (;;) {
      const { taken, holders } = claimFreeSlots(dir, budget, want, identity, staleMs);
      lastHolders = holders;
      const hasTakenSlots = taken.length > 0;
      if (hasTakenSlots) {
        const queuedMs = Date.now() - start;
        const grant = holdSlots(taken, budget, queuedMs, heartbeatMs);
        const isLongWait = queuedMs >= (options.longWaitMs ?? LONG_WAIT_MS) && Boolean(options.onLongWait);
        if (isLongWait) options.onLongWait({ queuedMs, budget, holders: lastHolders });
        return grant;
      }
      const now = Date.now();
      const waitedMs = now - start;
      const isBeatDue = now - lastBeat >= heartbeatMs || lastBeat === 0;
      if (isBeatDue) {
        writeWaiter(dir, { pid: process.pid, since: start, heartbeat: now, ...identity });
        lastBeat = now;
      }
      const position = liveWaiters(dir, now, staleMs).findIndex((record) => record.pid === process.pid) + 1 || 1;
      const isStatusDue = lastStatus === null || now - lastStatus >= statusMs;
      if (isStatusDue) {
        onWait(waitLine(budget, holders, position, waitedMs));
        lastStatus = now;
      }
      const hasTimedOut = waitTimeoutMs > 0 && waitedMs >= waitTimeoutMs;
      if (hasTimedOut) {
        const error = new Error(`chemx test: queued too long (${Math.round(waitedMs / 1000)}s), held by ${holderList(holders)}`);
        error.code = SLOT_WAIT_TIMEOUT_CODE;
        throw error;
      }
      const shouldReturnQueued = options.returnQueuedAfterMs !== undefined && waitedMs >= options.returnQueuedAfterMs;
      if (shouldReturnQueued) {
        const retryCommand = options.retryCommand || 'chemx test';
        return { queued: true, workers: 0, budget, queuedMs: waitedMs, nested: false, position, holders, retryCommand, release: () => {} };
      }
      const isAborted = Boolean(options.signal?.aborted);
      if (isAborted) throw new Error('chemx test: cancelled while waiting for a test slot');
      await delay(options.pollMs ?? DEFAULT_POLL_MS);
    }
  } finally {
    finish();
  }
};
