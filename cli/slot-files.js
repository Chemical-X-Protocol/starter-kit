// Shared helpers for the files under the slot directory (os.tmpdir()/chemx-test-slots): the mkdir
// mutex every read-then-write runs inside, the liveness test for a pid + heartbeat record, the
// budget, and the identity a holder records. test-slots.js (light lane) and job-line.js (heavy
// lane) both build on these; this module imports neither, so the two never form an import cycle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scheduleTimeout } from './timers.js';
import { readJsonOr } from './fs-json.js';

// Set in the runner's environment: a chemx test started by a spec inside a slot-holding run is
// already covered by its parent's slot, so it runs with one worker and never waits (no deadlock).
export const SLOT_OWNER_ENV = 'CHEMX_TEST_SLOT_OWNER';
const MUTEX_STALE_MS = 2000;
// Shared by both lanes: poll while waiting, refresh held files, treat a silent holder as dead after
// staleMs, print a waiting line every statusMs.
export const SLOT_DEFAULTS = Object.freeze({ pollMs: 200, heartbeatMs: 10000, staleMs: 60000, statusMs: 30000 });

export const defaultSlotsDir = (env = process.env) => env.CHEMX_TEST_SLOTS_DIR || path.join(os.tmpdir(), 'chemx-test-slots');

export const slotFile = (dir, index) => path.join(dir, `slot-${index}`);

// CHEMX_TEST_CONCURRENCY when it is a positive integer, otherwise half the cores (at least 1).
export const resolveTestBudget = (env = process.env, cores = os.availableParallelism()) => {
  const fromEnv = Number(env.CHEMX_TEST_CONCURRENCY);
  const hasOverride = Number.isInteger(fromEnv) && fromEnv > 0;
  return hasOverride ? fromEnv : Math.max(1, Math.floor(cores / 2));
};

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const delay = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));

// The critical section only reads and writes a few small files, so a mutex older than
// MUTEX_STALE_MS belongs to a process that died inside it. A slot dir removed under a live run (an
// `rm -rf` to unstick the line) is made again, so the run can still finish and hand over.
export const withMutex = (dir, fn) => {
  const lock = path.join(dir, '.mutex');
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      const isDirGone = error.code === 'ENOENT';
      if (isDirGone) {
        fs.mkdirSync(dir, { recursive: true });
        continue;
      }
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

// Runs `beat` every `ms` without keeping the process alive; returns the stop function. A failing
// beat (the slot directory removed under us, a full disk) is reported and tried again next tick: a
// heartbeat must never crash the run, or the MCP server, that it keeps alive.
export const everyBeat = (ms, beat) => {
  const timer = setInterval(() => {
    try {
      beat();
    } catch (error) {
      process.stderr.write(`chemx: slot heartbeat failed (${error.message}); trying again in ${ms}ms\n`);
    }
  }, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export const readHolder = (file) => readJsonOr(file, null);

// A record counts as live when its pid exists and, if it carries a heartbeat, the heartbeat is
// newer than the stale window.
export const isLive = (record, now, staleMs) => {
  const hasPid = Boolean(record) && Number.isInteger(record.pid);
  const hasHeartbeat = hasPid && typeof record.heartbeat === 'number';
  const isFresh = !hasHeartbeat || now - record.heartbeat <= staleMs;
  return hasPid && isFresh && isAlive(record.pid);
};

export const identityOf = (options, env) => ({
  handle: options.handle ?? env.CHEMX_AGENT_ID ?? null,
  task: options.task ?? env.CHEMX_TASK_ID ?? null,
  command: String(options.command ?? process.argv.slice(2).join(' ')).slice(0, 200)
});
