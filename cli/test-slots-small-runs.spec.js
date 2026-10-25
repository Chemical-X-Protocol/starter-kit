// The slot the line keeps for small runs (task #6772): a run naming many specs, a directory or a
// glob never takes the last slot, so `chemx test one.spec.js` does not queue behind full runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireTestSlots } from './test-slots.js';
import { runWithinBudget } from './test-run.js';
import { isBigRun, smallRunLimit, DEFAULT_SMALL_RUN } from './test-run-size.js';
import { scheduleTimeout } from './timers.js';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const slotNames = (dir) => fs.readdirSync(dir).filter((name) => name.startsWith('slot-')).sort();
const wait = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));

test('small runs: a big run leaves the last slot free, and a small run takes it at once', async () => {
  const dir = tempDir('chemx-small-');
  try {
    const big = await acquireTestSlots({ dir, budget: 6, want: 6, env: {}, bigRun: true });
    assert.equal(big.workers, 5, 'five of six slots');
    assert.deepEqual(slotNames(dir), ['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4']);
    const small = await acquireTestSlots({ dir, budget: 6, want: 1, env: {}, onWait: () => assert.fail('the kept slot was free') });
    assert.equal(small.workers, 1);
    assert.deepEqual(slotNames(dir), ['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5']);
    small.release();
    big.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: a second big run waits for a slot other than the kept one, and says so', async () => {
  const dir = tempDir('chemx-small-');
  const waits = [];
  try {
    const first = await acquireTestSlots({ dir, budget: 3, want: 3, env: {}, bigRun: true });
    assert.equal(first.workers, 2);
    let isSecondReady = false;
    const second = acquireTestSlots({ dir, budget: 3, want: 1, env: {}, bigRun: true, pollMs: 20, onWait: (line) => waits.push(line) })
      .then((grant) => { isSecondReady = true; return grant; });
    await wait(120);
    assert.equal(isSecondReady, false, 'slot 2 is kept for small runs');
    assert.equal(slotNames(dir).includes('slot-2'), false);
    first.release();
    (await second).release();
    assert.match(waits[0], /held by pid \d+ for \d+s/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: with nobody to name, a big run\'s wait notice mentions the kept slot', async () => {
  const dir = tempDir('chemx-small-');
  const waits = [];
  try {
    // Budget 2: slot 0 is the heavy line's, slot 1 is the reserve and the kept slot; both are free.
    fs.writeFileSync(path.join(dir, 'ticket-1'), JSON.stringify({ seq: 1, pid: process.pid, token: 't1', since: Date.now(), heartbeat: Date.now(), kind: 'tests', key: 'k', state: 'waiting' }));
    let isReady = false;
    const big = acquireTestSlots({ dir, budget: 2, want: 1, env: {}, bigRun: true, pollMs: 20, onWait: (line) => waits.push(line) })
      .then((grant) => { isReady = true; return grant; });
    await wait(100);
    assert.equal(isReady, false, 'no slot is open to a big run while a ticket is live');
    assert.match(waits[0], /held by the heavy line and the slot kept for small runs/);
    const small = await acquireTestSlots({ dir, budget: 2, want: 1, env: {}, onWait: () => assert.fail('the kept slot was free') });
    assert.equal(small.workers, 1);
    small.release();
    fs.rmSync(path.join(dir, 'ticket-1'));
    (await big).release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: a budget of 1 has no kept slot, and a run that is not big scans as before', async () => {
  const dir = tempDir('chemx-small-');
  try {
    const only = await acquireTestSlots({ dir, budget: 1, want: 1, env: {}, bigRun: true, onWait: () => assert.fail('one slot, nothing kept') });
    assert.equal(only.workers, 1);
    only.release();
    const small = await acquireTestSlots({ dir, budget: 6, want: 2, env: {} });
    assert.deepEqual(slotNames(dir), ['slot-4', 'slot-5'], 'a small run starts in the reserve');
    small.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: a run is big at smallRun files, or when it names a directory or a glob', () => {
  const dir = tempDir('chemx-size-');
  try {
    fs.mkdirSync(path.join(dir, 'specs'));
    for (const name of ['a', 'b', 'c', 'd', 'e']) fs.writeFileSync(path.join(dir, `${name}.spec.js`), '');
    const files = (n) => ['a', 'b', 'c', 'd', 'e'].slice(0, n).map((name) => `${name}.spec.js`);
    assert.equal(isBigRun({ cwd: dir, targets: files(1), limit: 5 }), false);
    assert.equal(isBigRun({ cwd: dir, targets: files(4), limit: 5 }), false);
    assert.equal(isBigRun({ cwd: dir, targets: files(5), limit: 5 }), true, 'N files is already big');
    assert.equal(isBigRun({ cwd: dir, targets: files(2), limit: 2 }), true);
    assert.equal(isBigRun({ cwd: dir, targets: ['specs'], limit: 5 }), true, 'a directory holds an unknown number');
    assert.equal(isBigRun({ cwd: dir, targets: ['*.spec.js'], limit: 5 }), true);
    assert.equal(isBigRun({ cwd: dir, targets: ['Foo'], limit: 5 }), false, 'a name filter counts as one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: the limit comes from test-lanes.json "smallRun" and defaults to 5', () => {
  const dir = tempDir('chemx-size-');
  try {
    assert.equal(smallRunLimit(dir), DEFAULT_SMALL_RUN);
    assert.equal(DEFAULT_SMALL_RUN, 5);
    fs.writeFileSync(path.join(dir, 'test-lanes.json'), JSON.stringify({ slow: [], excluded: [], smallRun: 3 }));
    assert.equal(smallRunLimit(dir), 3);
    fs.writeFileSync(path.join(dir, 'test-lanes.json'), JSON.stringify({ slow: [], smallRun: 'many' }));
    assert.equal(smallRunLimit(dir), 5, 'junk falls back to the default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('small runs: a run that names six spec files keeps the last slot free while it runs, one that names two does not', async () => {
  const dir = tempDir('chemx-size-');
  const slots = tempDir('chemx-small-');
  try {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${name}.spec.js`);
    for (const name of names) fs.writeFileSync(path.join(dir, name), '');
    const env = { CHEMX_TEST_SLOTS_DIR: slots, CHEMX_TEST_CONCURRENCY: '6', CHEMX_LIGHT_RESERVE: '2' };
    const command = 'node -e "setTimeout(() => {}, 700)"';
    const running = runWithinBudget({ command, cwd: dir, runner: null, targets: names }, { env, heavy: false, onWait: () => {} });
    await wait(300);
    assert.deepEqual(slotNames(slots), ['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4'], 'six files: five workers, slot 5 kept');
    const outcome = await running;
    assert.equal(outcome.workers, 5);
    const small = runWithinBudget({ command, cwd: dir, runner: null, targets: names.slice(0, 2) }, { env, heavy: false, onWait: () => {} });
    await wait(300);
    assert.deepEqual(slotNames(slots), ['slot-4', 'slot-5'], 'two files: a small run starts in the reserve');
    await small;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(slots, { recursive: true, force: true });
  }
});
