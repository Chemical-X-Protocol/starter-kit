import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runHeavy, resolveLanes, jobKey, HEAVY_KINDS } from './job-line.js';
import { acquireTestSlots, listTestSlots, formatTestSlots, SLOT_OWNER_ENV } from './test-slots.js';
import { scheduleTimeout } from './timers.js';

// Budget 6 with the default reserve of 2: heavy jobs hold slots 0-3, light runs keep 4-5.
const ENV = { CHEMX_TEST_CONCURRENCY: '6', CHEMX_LIGHT_RESERVE: '2' };
const FAST = { pollMs: 5, statusMs: 50, heartbeatMs: 20, staleMs: 200 };
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-line-'));
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
const delay = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));
const named = (dir, prefix) => fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
const readSlot = (dir, index) => JSON.parse(fs.readFileSync(path.join(dir, `slot-${index}`), 'utf8'));
const lineFiles = (dir) => fs.readdirSync(dir).filter((name) => /^(ticket|join|result|slot)-/.test(name));
const options = (dir, extra = {}) => ({ dir, env: ENV, onWait: () => {}, ...FAST, ...extra });

// A run the test holds open: `started` settles when run begins, finish() lets every call end.
const heldRun = (value, log = [], name = 'job') => {
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

const withDir = (body) => async () => {
  const dir = tempDir();
  try {
    await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('job-line: the lanes split the budget, keeping at least one slot each way', () => {
  assert.deepEqual(resolveLanes({}, 6), { budget: 6, heavy: 4, reserve: 2 });
  assert.equal(resolveLanes({ CHEMX_LIGHT_RESERVE: '0' }, 6).reserve, 1);
  assert.deepEqual(resolveLanes({}, 1), { budget: 1, heavy: 1, reserve: 0 });
  assert.deepEqual(resolveLanes({}, 2), { budget: 2, heavy: 1, reserve: 1 });
  assert.deepEqual(resolveLanes({ CHEMX_LIGHT_RESERVE: '3' }, 6), { budget: 6, heavy: 3, reserve: 3 });
  assert.deepEqual(HEAVY_KINDS, ['tests', 'typecheck', 'build']);
  assert.equal(jobKey({ kind: 'tests', cwd: '/repo/./x', command: 'npm test' }), 'tests:/repo/x:npm test');
});

test('job-line: two heavy jobs with different keys run one after the other, in call order', withDir(async (dir) => {
  const log = [];
  const first = heldRun('a', log, 'a');
  const second = heldRun('b', log, 'b');
  const runs = [
    runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, first.run),
    runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, second.run)
  ];
  await first.started;
  await delay(40);
  assert.deepEqual(log, ['a:start'], 'the second waits while the first runs');
  first.finish();
  await second.started;
  second.finish();
  const [a, b] = await Promise.all(runs);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
  assert.deepEqual([a.workers, b.workers, a.result, b.result], [4, 4, 'a', 'b']);
  assert.equal(a.shared, null);
  assert.equal(b.shared, null);
  assert.deepEqual(lineFiles(dir), [], 'tickets and slots are gone');
}));

test('job-line: callers with the same key join a waiting ticket and share one run', withDir(async (dir) => {
  const blocker = heldRun('a');
  const shared = heldRun({ exitCode: 0, stdout: 'ok' });
  const ahead = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, blocker.run);
  await blocker.started;
  const callers = ['@b1', '@b2', '@b3'].map((handle) => runHeavy({ kind: 'tests', key: 'k:b', ...options(dir, { handle }) }, shared.run));
  assert.deepEqual(named(dir, 'ticket-'), ['ticket-1', 'ticket-2']);
  assert.equal(named(dir, 'join-2-').length, 2, 'the second and third caller joined the first one\'s ticket');
  blocker.finish();
  await shared.started;
  shared.finish();
  const results = await Promise.all(callers);
  await ahead;
  assert.deepEqual(shared.calls, [4], 'the shared run ran once');
  for (const outcome of results) assert.deepEqual(outcome.result, { exitCode: 0, stdout: 'ok' });
  for (const outcome of results) assert.deepEqual(outcome.shared, { owner: '@b1', joined: 2, seq: 2 });
  assert.deepEqual(lineFiles(dir), [], 'the last reader removed the result');
}));

test('job-line: an old-chemx slot (no seq) keeps a heavy ticket waiting and lists as a light holder', withDir(async (dir) => {
  fs.writeFileSync(path.join(dir, 'slot-0'), JSON.stringify({ pid: process.pid, since: Date.now(), handle: '@old' }));
  const job = heldRun('x');
  const running = runHeavy({ kind: 'build', key: 'k', ...options(dir) }, job.run);
  await delay(40);
  assert.deepEqual(job.calls, [], 'the old holder keeps the heavy ticket waiting');
  const snapshot = listTestSlots({ dir, env: ENV });
  assert.equal(snapshot.holders[0].lane, 'light');
  assert.equal(snapshot.tickets[0].state, 'waiting');
  fs.rmSync(path.join(dir, 'slot-0'));
  await job.started;
  assert.equal(readSlot(dir, 0).seq, 1, 'the heavy job now holds slot 0');
  job.finish();
  await running;
}));

test('job-line: a caller with the same key after the run started takes its own ticket', withDir(async (dir) => {
  const job = heldRun('x');
  const first = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  await job.started;
  const second = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  assert.deepEqual(named(dir, 'join-'), [], 'a running ticket takes no joiners');
  assert.deepEqual(named(dir, 'ticket-'), ['ticket-1', 'ticket-2']);
  job.finish();
  const [, late] = await Promise.all([first, second]);
  assert.deepEqual(job.calls, [4, 4], 'run was called twice');
  assert.equal(late.shared, null);
}));

test('job-line: heartbeats keep a run and a waiting ticket live past the stale window', withDir(async (dir) => {
  const log = [];
  const first = heldRun('a', log, 'a');
  const runs = [
    runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, first.run),
    runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, async () => log.push('b:start'))
  ];
  await first.started;
  const ticketBeat = (seq) => JSON.parse(fs.readFileSync(path.join(dir, `ticket-${seq}`), 'utf8')).heartbeat;
  const before = { running: ticketBeat(1), waiting: ticketBeat(2), slot: readSlot(dir, 0).heartbeat };
  await delay(FAST.staleMs * 2);
  assert.deepEqual(log, ['a:start'], 'the running job stayed live, so the next one did not start beside it');
  assert.ok(ticketBeat(1) > before.running, 'the running ticket was refreshed');
  assert.ok(ticketBeat(2) > before.waiting, 'the waiting ticket was refreshed');
  assert.ok(readSlot(dir, 0).heartbeat > before.slot, 'the heavy slots were refreshed');
  first.finish();
  await Promise.all(runs);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start']);
}));

test('job-line: a light run while a heavy job runs gets slots 4 and 5 at once', withDir(async (dir) => {
  const job = heldRun('x');
  const heavy = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  await job.started;
  const grant = await acquireTestSlots({ dir, env: ENV, want: 6, onWait: () => assert.fail('a light run never waits behind a heavy one') });
  assert.equal(grant.workers, 2);
  assert.equal(readSlot(dir, 4).seq, undefined);
  assert.equal(readSlot(dir, 5).seq, undefined);
  assert.deepEqual([0, 1, 2, 3].map((index) => readSlot(dir, index).seq), [1, 1, 1, 1]);
  grant.release();
  job.finish();
  await heavy;
}));

test('job-line: while a heavy ticket waits for light holders, a new light run claims only 4-5', withDir(async (dir) => {
  const lights = [];
  for (let index = 0; index < 4; index++) lights.push(await acquireTestSlots({ dir, env: ENV, want: 1 }));
  const job = heldRun('x');
  const heavy = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  lights[1].release();
  const late = await acquireTestSlots({ dir, env: ENV, want: 2, onWait: () => assert.fail('the reserve was free') });
  assert.equal(late.workers, 2);
  assert.equal(fs.existsSync(path.join(dir, 'slot-1')), false, 'the freed heavy slot is kept for the line');
  assert.deepEqual(named(dir, 'slot-'), ['slot-0', 'slot-2', 'slot-3', 'slot-4', 'slot-5']);
  await delay(30);
  assert.deepEqual(job.calls, [], 'the heavy job waits for slots 0-3 to drain');
  for (const grant of [lights[0], lights[2], lights[3]]) grant.release();
  await job.started;
  assert.deepEqual(job.calls, [4]);
  job.finish();
  late.release();
  await heavy;
}));

test('job-line: a dead ticket blocks nobody', withDir(async (dir) => {
  const ghost = { seq: 1, pid: deadPid(), token: 'ghost', since: 0, heartbeat: 0, kind: 'tests', key: 'k:ghost', state: 'running' };
  fs.writeFileSync(path.join(dir, 'ticket-1'), JSON.stringify(ghost));
  fs.writeFileSync(path.join(dir, 'seq'), '1');
  const onWait = () => assert.fail('a dead ticket must not keep anyone waiting');
  const outcome = await runHeavy({ kind: 'build', key: 'k', ...options(dir, { onWait }) }, async () => 'done');
  assert.equal(outcome.result, 'done');
  assert.equal(fs.existsSync(path.join(dir, 'ticket-1')), false, 'the dead ticket was removed');
}));

test('job-line: the joiner of an owner that died takes the ticket over and runs it', withDir(async (dir) => {
  const now = Date.now();
  const owner = { seq: 1, pid: process.pid, token: 'ghost', since: now, heartbeat: now, kind: 'tests', key: 'k', state: 'waiting', handle: '@ghost' };
  fs.writeFileSync(path.join(dir, 'ticket-1'), JSON.stringify(owner));
  fs.writeFileSync(path.join(dir, 'seq'), '1');
  const job = heldRun('ran');
  const joiner = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  assert.equal(named(dir, 'join-1-').length, 1, 'it joined the waiting ticket');
  fs.writeFileSync(path.join(dir, 'ticket-1'), JSON.stringify({ ...owner, pid: deadPid() }));
  await job.started;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ticket-1'), 'utf8')).pid, process.pid, 'same seq, new owner');
  job.finish();
  const outcome = await joiner;
  assert.equal(outcome.result, 'ran');
  assert.deepEqual(job.calls, [4]);
  assert.equal(outcome.shared, null, 'nobody else joined');
  assert.deepEqual(lineFiles(dir), []);
}));

test('job-line: returnQueuedAfterMs behind a running ticket returns queued, holding nothing', withDir(async (dir) => {
  const job = heldRun('x');
  const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, job.run);
  await job.started;
  const later = { returnQueuedAfterMs: 20, retryCommand: 'chemx build' };
  const outcome = await runHeavy({ kind: 'build', key: 'k:b', ...options(dir, later) }, async () => assert.fail('a queued caller runs nothing'));
  assert.equal(outcome.queued, true);
  assert.equal(outcome.position, 2);
  assert.equal(outcome.workers, 0);
  assert.equal(outcome.retryCommand, 'chemx build');
  assert.equal(outcome.ahead[0].kind, 'tests');
  assert.deepEqual(named(dir, 'ticket-'), ['ticket-1'], 'its ticket is gone');
  job.finish();
  await first;
}));

test('job-line: a cancelled waiter leaves the line and says so', withDir(async (dir) => {
  const job = heldRun('x');
  const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, job.run);
  await job.started;
  const controller = new AbortController();
  const waiting = runHeavy({ kind: 'build', key: 'k:b', ...options(dir, { signal: controller.signal }) }, async () => 'b');
  controller.abort();
  await assert.rejects(waiting, /chemx: cancelled while waiting in line/);
  assert.deepEqual(named(dir, 'ticket-'), ['ticket-1']);
  job.finish();
  await first;
}));

test('job-line: a nested run (SLOT_OWNER_ENV set) runs at once on one worker and writes nothing', async () => {
  const parent = tempDir();
  const dir = path.join(parent, 'slots');
  try {
    const calls = [];
    const outcome = await runHeavy({ kind: 'tests', key: 'k', dir, env: { ...ENV, [SLOT_OWNER_ENV]: '123' } }, async (workers) => {
      calls.push(workers);
      return 'nested';
    });
    assert.deepEqual(calls, [1]);
    assert.equal(outcome.result, 'nested');
    assert.equal(outcome.workers, 1);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('job-line: the wait line names the running job and the line ahead, once and then every statusMs', withDir(async (dir) => {
  const job = heldRun('x');
  const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir, { env: { ...ENV, CHEMX_AGENT_ID: '@a' } }) }, job.run);
  await job.started;
  const lines = [];
  const second = runHeavy({ kind: 'build', key: 'k:b', ...options(dir, { onWait: (line) => lines.push(line) }) }, async () => 'b');
  assert.deepEqual(lines, ['chemx: in line #2 for build (budget 6, heavy 4): running tests for @a 0s; ahead: tests\n']);
  await delay(80);
  assert.ok(lines.length >= 2, `expected a repeat after statusMs, got ${lines.length}`);
  job.finish();
  await Promise.all([first, second]);
}));

test('job-line: the slot listing names the running ticket and its joiners', withDir(async (dir) => {
  const job = heldRun('x');
  const first = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { env: { ...ENV, CHEMX_AGENT_ID: '@a', CHEMX_TASK_ID: '7' } }) }, job.run);
  await job.started;
  const snapshot = listTestSlots({ dir, env: ENV });
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.tickets[0].handle, '@a');
  assert.equal(snapshot.holders[0].lane, 'heavy');
  const text = formatTestSlots(snapshot);
  assert.match(text, /\n {2}line #1 running tests: @a \(task 7\), \d+s, 0 joined\n/);
  assert.match(text, /slot 0 held: @a, task 7/);
  job.finish();
  await first;
}));
