// Cross-process test worker budget. Every `chemx test` run (CLI, MCP, verify) takes worker slots
// from lock files under os.tmpdir()/chemx-test-slots before it starts the runner, so concurrent
// runs from several agents never exceed the machine budget in total. A slot file holds the pid
// of the run that owns it; a slot whose pid is dead is reclaimed. A short mkdir mutex makes the
// scan-and-claim atomic across processes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scheduleTimeout } from './timers.js';

// Set in the runner's environment: a chemx test started by a spec inside a slot-holding run is
// already covered by its parent's slot, so it runs with one worker and never waits (no deadlock).
export const SLOT_OWNER_ENV = 'CHEMX_TEST_SLOT_OWNER';
const MUTEX_STALE_MS = 2000;
const DEFAULT_POLL_MS = 200;

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
      if (error.code !== 'EEXIST') throw error;
      const mtime = fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now();
      if (Date.now() - mtime > MUTEX_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      else sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
};

const readHolder = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Claims up to `want` free slots (indices below `budget`); returns the claimed files and the
// live pids holding the rest.
const claimFreeSlots = (dir, budget, want) => withMutex(dir, () => {
  const taken = [];
  const holders = [];
  for (let index = 0; index < budget && taken.length < want; index++) {
    const file = path.join(dir, `slot-${index}`);
    const holder = readHolder(file);
    const isHeld = Boolean(holder) && isAlive(holder.pid);
    if (isHeld) {
      holders.push(holder.pid);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, since: Date.now() }));
    taken.push(file);
  }
  return { taken, holders };
});

const holdSlots = (taken, budget, queuedMs) => {
  const releaseSync = () => {
    for (const file of taken) {
      const isStillOurs = readHolder(file)?.pid === process.pid;
      if (isStillOurs) fs.rmSync(file, { force: true });
    }
  };
  process.once('exit', releaseSync);
  const release = () => {
    process.removeListener('exit', releaseSync);
    releaseSync();
  };
  return { workers: taken.length, budget, queuedMs, nested: false, release };
};

const waitLine = (budget, holders) => `chemx test: waiting for a test slot (budget ${budget} worker(s), held by pid ${[...new Set(holders)].join(', ')}; set CHEMX_TEST_CONCURRENCY to change)\n`;
const delay = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));

// Resolves to { workers, budget, queuedMs, nested, release } once at least one slot is free.
// A run takes min(want, free slots) workers; the waiting run reports itself once via onWait.
export const acquireTestSlots = async (options = {}) => {
  const env = options.env || process.env;
  const budget = options.budget ?? resolveTestBudget(env);
  const want = Math.max(1, Math.min(options.want ?? budget, budget));
  const isNested = Boolean(env[SLOT_OWNER_ENV]);
  if (isNested) return { workers: 1, budget, queuedMs: 0, nested: true, release: () => {} };
  const dir = options.dir || defaultSlotsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const onWait = options.onWait || ((line) => process.stderr.write(line));
  const start = Date.now();
  let hasAnnounced = false;
  for (;;) {
    const { taken, holders } = claimFreeSlots(dir, budget, want);
    if (taken.length > 0) return holdSlots(taken, budget, Date.now() - start);
    if (!hasAnnounced) onWait(waitLine(budget, holders));
    hasAnnounced = true;
    if (options.signal?.aborted) throw new Error('chemx test: cancelled while waiting for a test slot');
    await delay(options.pollMs ?? DEFAULT_POLL_MS);
  }
};
