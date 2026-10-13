// Shared by the job line specs (job-line.spec.js, job-line-takeover.spec.js): a temp slot dir per
// test, fast clocks, and runs the test holds open so every interleaving is chosen, not timed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scheduleTimeout } from './timers.js';

// Budget 6 with the default reserve of 2: heavy jobs hold slots 0-3, light runs keep 4-5.
export const ENV = { CHEMX_TEST_CONCURRENCY: '6', CHEMX_LIGHT_RESERVE: '2' };
export const FAST = { pollMs: 5, statusMs: 50, heartbeatMs: 20, staleMs: 200 };
export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-line-'));
export const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
export const delay = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));
export const named = (dir, prefix) => fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
export const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
export const readSlot = (dir, index) => readJson(dir, `slot-${index}`);
export const readTicketFile = (dir, seq) => readJson(dir, `ticket-${seq}`);
export const writeJson = (dir, name, record) => fs.writeFileSync(path.join(dir, name), JSON.stringify(record));
export const lineFiles = (dir) => fs.readdirSync(dir).filter((name) => /^(ticket|join|result|slot)-/.test(name));
export const options = (dir, extra = {}) => ({ dir, env: ENV, onWait: () => {}, onWarn: () => {}, ...FAST, ...extra });

// The token of the one caller that joined `seq` (from its join file), to tell a takeover's ticket apart.
export const joinToken = (dir, seq) => {
  const joins = named(dir, `join-${seq}-`);
  assert.equal(joins.length, 1, `expected one join of #${seq}, found ${joins.length}`);
  return readJson(dir, joins[0]).token;
};

// A hand-written record another process would leave. With no heartbeat it is judged by its pid
// alone (this process), so it stays live however slowly the test runs.
export const liveRecord = (extra = {}) => ({ pid: process.pid, since: Date.now(), kind: 'tests', ...extra });

// A run the test holds open: `started` settles when run begins, finish() lets every call end.
export const heldRun = (value, log = [], name = 'job') => {
  let markStarted;
  let open;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gate = new Promise((resolve) => { open = resolve; });
  const calls = [];
  const run = async (workers) => {
    calls.push(workers);
    log.push(`${name}:start`);
    markStarted();
    await gate;
    log.push(`${name}:end`);
    return value;
  };
  return { run, started, calls, finish: () => open() };
};

// Waits (in small steps, up to 5 s) until `isDone()` holds; fails naming `what` otherwise.
export const until = async (isDone, what) => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const isReady = isDone();
    if (isReady) return;
    const hasTimedOut = Date.now() > deadline;
    if (hasTimedOut) assert.fail(`timed out waiting for ${what}`);
    await delay(2);
  }
};

export const withDir = (body) => async () => {
  const dir = tempDir();
  try {
    await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
