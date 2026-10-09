import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestBudget, acquireTestSlots, SLOT_OWNER_ENV } from './test-slots.js';
import { withWorkerCount } from './test-workers.js';
import { runTestAudit } from './test-audit.js';
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
    await new Promise((resolve) => setTimeout(resolve, 150));
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
