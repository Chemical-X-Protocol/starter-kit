import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestBudget, acquireTestSlots, listTestSlots, formatTestSlots, SLOT_OWNER_ENV, SLOT_WAIT_TIMEOUT_CODE } from './test-slots.js';
import { scheduleTimeout } from './timers.js';
import { withWorkerCount } from './test-workers.js';
import { runTestAudit } from './test-audit.js';
import { handleChemxTest } from './mcp/tools-verify.js';
import { STATUS } from './result-status.js';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

test('test-slots: the default budget is half the cores (at least 1); CHEMX_TEST_CONCURRENCY overrides it', () => {
  assert.equal(resolveTestBudget({}, 12), 6);
  assert.equal(resolveTestBudget({}, 1), 1);
  assert.equal(resolveTestBudget({ CHEMX_TEST_CONCURRENCY: '3' }, 12), 3);
  assert.equal(resolveTestBudget({ CHEMX_TEST_CONCURRENCY: 'lots' }, 12), 6, 'an invalid override is ignored');
});

test('test-slots: a second run waits (announcing it once) until the first releases its slots', async () => {
  const dir = tempDir('chemx-slots-');
  const waits = [];
  try {
    const first = await acquireTestSlots({ dir, budget: 3, want: 5, env: {} });
    assert.equal(first.workers, 3, 'a run never takes more than the budget');
    let secondReady = false;
    const second = acquireTestSlots({ dir, budget: 3, want: 2, env: {}, pollMs: 20, onWait: (line) => waits.push(line) })
      .then((grant) => { secondReady = true; return grant; });
    await new Promise((resolve) => scheduleTimeout(resolve, 150));
    assert.equal(secondReady, false, 'all slots are held, so the second run is queued');
    first.release();
    const grant = await second;
    assert.equal(grant.workers, 2);
    assert.equal(waits.length, 1, 'the queued run prints exactly one line');
    assert.match(waits[0], /waiting for a test slot/);
    grant.release();
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith('slot-')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: a slot left by a dead process is reclaimed', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    fs.writeFileSync(path.join(dir, 'slot-0'), JSON.stringify({ pid: deadPid(), since: 0 }));
    const grant = await acquireTestSlots({ dir, budget: 1, want: 1, env: {}, onWait: () => assert.fail('must not wait on a dead holder') });
    assert.equal(grant.workers, 1);
    grant.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: a run nested inside a slot holder uses one worker and takes no slot (no deadlock)', async () => {
  const grant = await acquireTestSlots({ dir: path.join(os.tmpdir(), 'chemx-never-created'), budget: 4, env: { [SLOT_OWNER_ENV]: '123' } });
  assert.equal(grant.workers, 1);
  assert.equal(grant.nested, true);
});

test('test-workers: the granted worker count reaches the runner', () => {
  assert.equal(withWorkerCount('node --test --test-concurrency=8 cli/*.spec.js', 'node', 2), 'node --test --test-concurrency=2 cli/*.spec.js');
  assert.equal(withWorkerCount('node --test cli/a.spec.js', 'node', 3), 'node --test --test-concurrency=3 cli/a.spec.js');
  assert.equal(withWorkerCount('npx vitest run a.spec.ts', 'vitest', 2), 'npx vitest run a.spec.ts --maxWorkers=2');
  assert.equal(withWorkerCount('npx jest --maxWorkers=9', 'jest', 2), 'npx jest --maxWorkers=2');
});

const PROBE_SPEC = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import test from 'node:test';",
  "test('probe', async () => {",
  '  const dir = process.env.PROBE_DIR;',
  '  const me = path.join(dir, String(process.pid));',
  "  fs.writeFileSync(me, '');",
  "  fs.appendFileSync(dir + '.log', fs.readdirSync(dir).length + '\\n');",
  '  await new Promise((resolve) => setTimeout(resolve, 300));',
  '  fs.rmSync(me);',
  '});'
].join('\n');

test('test-slots: two concurrent chemx test runs never exceed the budget in total', { timeout: 60000 }, async () => {
  const root = tempDir('chemx-slots-project-');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test spec/*.spec.js' } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'spec'));
    for (const name of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(root, `spec/${name}.spec.js`), PROBE_SPEC);
    const probeDir = path.join(root, 'active');
    fs.mkdirSync(probeDir);
    const { [SLOT_OWNER_ENV]: _owner, ...parentEnv } = process.env;
    const env = { ...parentEnv, PROBE_DIR: probeDir, CHEMX_TEST_CONCURRENCY: '2', CHEMX_TEST_SLOTS_DIR: path.join(root, 'slots') };
    const run = () => runTestAudit(['--json'], false, { cwd: root, print: false, env, onWait: () => {} });
    const reports = await Promise.all([run(), run()]);
    for (const report of reports) assert.equal(report.status, STATUS.PASS, report.command);
    const counts = fs.readFileSync(`${probeDir}.log`, 'utf8').trim().split('\n').map(Number);
    assert.equal(counts.length, 8);
    assert.ok(Math.max(...counts) <= 2, `max concurrent workers ${Math.max(...counts)} exceeds the budget of 2`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-slots: a live pid with a stale heartbeat (a reused pid) is reclaimed', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    fs.writeFileSync(path.join(dir, 'slot-0'), JSON.stringify({ pid: process.pid, since: 0, heartbeat: Date.now() - 120000, handle: '@ghost' }));
    const grant = await acquireTestSlots({ dir, budget: 1, want: 1, env: {}, staleMs: 60000, onWait: () => assert.fail('must not wait on a stale heartbeat') });
    assert.equal(grant.workers, 1);
    grant.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: a held slot records the handle and task, and its heartbeat is refreshed', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    const grant = await acquireTestSlots({ dir, budget: 1, env: { CHEMX_AGENT_ID: '@a', CHEMX_TASK_ID: '7' }, heartbeatMs: 20, command: 'test x' });
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'slot-0'), 'utf8'));
    assert.equal(before.handle, '@a');
    assert.equal(before.task, '7');
    assert.equal(before.command, 'test x');
    await new Promise((resolve) => scheduleTimeout(resolve, 120));
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'slot-0'), 'utf8'));
    assert.ok(after.heartbeat > before.heartbeat, 'heartbeat advanced while held');
    grant.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: a queued run prints periodic status naming the holder, then fails at the wait timeout', async () => {
  const dir = tempDir('chemx-slots-');
  const lines = [];
  try {
    const first = await acquireTestSlots({ dir, budget: 1, env: { CHEMX_AGENT_ID: '@holder', CHEMX_TASK_ID: '9' } });
    await assert.rejects(
      acquireTestSlots({ dir, budget: 1, env: {}, pollMs: 10, statusMs: 40, waitTimeoutMs: 200, onWait: (line) => lines.push(line) }),
      (error) => error.code === SLOT_WAIT_TIMEOUT_CODE && /queued too long.*@holder/.test(error.message)
    );
    assert.ok(lines.length >= 2, `expected repeated status lines, got ${lines.length}`);
    assert.match(lines[0], /@holder task 9/);
    assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('wait-')).length, 0, 'the waiter file is cleaned up');
    first.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: returnQueuedAfterMs returns queued status instead of blocking, holding nothing', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    const first = await acquireTestSlots({ dir, budget: 1, env: {} });
    const started = Date.now();
    const result = await acquireTestSlots({ dir, budget: 1, env: {}, pollMs: 10, returnQueuedAfterMs: 100, retryCommand: 'chemx test a.spec.js', onWait: () => {} });
    assert.ok(Date.now() - started < 2000);
    assert.equal(result.queued, true);
    assert.equal(result.workers, 0);
    assert.equal(result.position, 1);
    assert.equal(result.retryCommand, 'chemx test a.spec.js');
    assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('wait-')).length, 0);
    first.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-slots: listTestSlots and formatTestSlots show holders with handle, task and age', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    const first = await acquireTestSlots({ dir, budget: 2, want: 1, env: { CHEMX_AGENT_ID: '@lister', CHEMX_TASK_ID: '12' } });
    const snapshot = listTestSlots({ dir, budget: 2, env: {} });
    assert.equal(snapshot.holders.length, 1);
    assert.equal(snapshot.holders[0].handle, '@lister');
    assert.equal(snapshot.holders[0].task, '12');
    assert.equal(snapshot.holders[0].state, 'held');
    assert.deepEqual(snapshot.waiting, []);
    const text = formatTestSlots(snapshot);
    assert.match(text, /1 of 2 held/);
    assert.match(text, /@lister, task 12/);
    assert.deepEqual(listTestSlots({ dir: path.join(dir, 'missing'), budget: 2, env: {} }).holders, []);
    first.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const projectWithSlots = (budgetEnv = {}) => {
  const root = tempDir('chemx-slots-project-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test spec/*.spec.js' } }));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'spec'));
  fs.writeFileSync(path.join(root, 'spec/a.spec.js'), "import test from 'node:test';\ntest('a', () => {});\n");
  const { [SLOT_OWNER_ENV]: _owner, ...parentEnv } = process.env;
  const env = { ...parentEnv, CHEMX_TEST_CONCURRENCY: '1', CHEMX_TEST_SLOTS_DIR: path.join(root, 'slots'), ...budgetEnv };
  return { root, env };
};

test('test-slots: chemx test --slots lists holders with handle, task and age, as text and JSON', async () => {
  const { root, env } = projectWithSlots();
  try {
    const held = await acquireTestSlots({ dir: env.CHEMX_TEST_SLOTS_DIR, budget: 1, env: { CHEMX_AGENT_ID: '@holder', CHEMX_TASK_ID: '41' } });
    const report = await runTestAudit(['--slots', '--json'], false, { cwd: root, print: false, env });
    assert.equal(report.success, true);
    assert.equal(report.holders[0].handle, '@holder');
    assert.equal(report.holders[0].task, '41');
    assert.equal(typeof report.holders[0].ageMs, 'number');
    held.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-slots: chemx test --wait-timeout gives up with an inconclusive "queued too long" report, running nothing', async () => {
  const { root, env } = projectWithSlots();
  try {
    const held = await acquireTestSlots({ dir: env.CHEMX_TEST_SLOTS_DIR, budget: 1, env: { CHEMX_AGENT_ID: '@holder' } });
    const report = await runTestAudit(['--json', '--wait-timeout=1'], false, { cwd: root, print: false, env, onWait: () => {} });
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.equal(report.reason, 'QUEUE_TIMEOUT');
    assert.match(report.detail, /queued too long.*@holder.*no tests ran/);
    held.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-slots: an MCP test call under a full budget returns queued status within 2 seconds', async () => {
  const { root, env } = projectWithSlots();
  const saved = { dir: process.env.CHEMX_TEST_SLOTS_DIR, conc: process.env.CHEMX_TEST_CONCURRENCY, owner: process.env[SLOT_OWNER_ENV] };
  Object.assign(process.env, { CHEMX_TEST_SLOTS_DIR: env.CHEMX_TEST_SLOTS_DIR, CHEMX_TEST_CONCURRENCY: '1' });
  delete process.env[SLOT_OWNER_ENV];
  try {
    const held = await acquireTestSlots({ dir: env.CHEMX_TEST_SLOTS_DIR, budget: 1, env: { CHEMX_AGENT_ID: '@holder' } });
    const started = Date.now();
    const report = await handleChemxTest({ dir: root });
    assert.ok(Date.now() - started < 2500, `took ${Date.now() - started}ms`);
    assert.equal(report.queued, true);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.match(report.retryCommand, /chemx test/);
    assert.equal(report.holders[0].handle, '@holder');
    held.release();
  } finally {
    for (const [key, value] of [['CHEMX_TEST_SLOTS_DIR', saved.dir], ['CHEMX_TEST_CONCURRENCY', saved.conc], [SLOT_OWNER_ENV, saved.owner]]) {
      const isUnset = value === undefined;
      if (isUnset) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test-slots: onLongWait fires once after a grant that waited past longWaitMs', async () => {
  const dir = tempDir('chemx-slots-');
  try {
    const first = await acquireTestSlots({ dir, budget: 1, env: { CHEMX_AGENT_ID: '@holder' } });
    const events = [];
    const second = acquireTestSlots({ dir, budget: 1, env: {}, pollMs: 10, longWaitMs: 50, onLongWait: (info) => events.push(info), onWait: () => {} });
    await new Promise((resolve) => scheduleTimeout(resolve, 120));
    first.release();
    (await second).release();
    assert.equal(events.length, 1);
    assert.ok(events[0].queuedMs >= 50);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
