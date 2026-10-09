// End to end: `chemx test` picks the lane, --profile reports, --related= and --depth work.
// Named *.slow.spec.js, so the lane manifest's naming convention puts it in the slow lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestAudit } from './test-audit.js';
import { SLOT_OWNER_ENV } from './test-slots.js';
import { STATUS } from './result-status.js';

const oneTest = (name) => `import test from 'node:test';\ntest('${name}', () => {});\n`;
const MANIFEST = { slow: [{ glob: 'b/*.spec.js', why: 'temp project slow lane' }], excluded: [] };

// Fast lane: a/one (2 tests), a/two (1 test). Slow lane: b/heavy (1 test).
const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lane-run-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test a/*.spec.js b/*.spec.js' } }));
  fs.writeFileSync(path.join(root, 'test-lanes.json'), JSON.stringify(MANIFEST));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'a'));
  fs.mkdirSync(path.join(root, 'b'));
  fs.writeFileSync(path.join(root, 'a/one.spec.js'), `${oneTest('one-a')}${oneTest('one-b').split('\n').slice(1).join('\n')}`);
  fs.writeFileSync(path.join(root, 'a/two.spec.js'), oneTest('two'));
  fs.writeFileSync(path.join(root, 'b/heavy.spec.js'), oneTest('heavy'));
  return root;
};

const envFor = (root) => {
  const { [SLOT_OWNER_ENV]: _owner, ...parentEnv } = process.env;
  return { ...parentEnv, CHEMX_TEST_CONCURRENCY: '2', CHEMX_TEST_SLOTS_DIR: path.join(root, 'slots') };
};

const run = (root, args) => runTestAudit(args, false, { cwd: root, print: false, env: envFor(root), onWait: () => {} });

test('test lanes: the default run is the fast lane, --slow the slow lane, --all everything', { timeout: 60000 }, async () => {
  const root = makeProject();
  try {
    const fast = await run(root, ['--json']);
    assert.equal(fast.status, STATUS.PASS);
    assert.equal(fast.totalTests, 3, 'a/one (2 tests) and a/two (1 test)');
    assert.ok(!fast.command.includes('b/heavy.spec.js'), fast.command);
    const slow = await run(root, ['--slow', '--json']);
    assert.equal(slow.totalTests, 1);
    assert.ok(slow.command.includes('b/heavy.spec.js'));
    const all = await run(root, ['--all', '--json']);
    assert.equal(all.totalTests, 4, '--all runs the project test script, both lanes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test lanes: --related= (equals form) selects the spec, and a slow-lane spec is reported as not run', { timeout: 60000 }, async () => {
  const root = makeProject();
  try {
    const equalsForm = await run(root, ['--related=a/two.spec.js', '--json']);
    assert.equal(equalsForm.status, STATUS.PASS);
    assert.equal(equalsForm.totalTests, 1);
    const slowOnly = await run(root, ['--related=b/heavy.spec.js', '--json']);
    assert.equal(slowOnly.status, STATUS.INCONCLUSIVE, 'nothing in the fast lane was affected');
    assert.match(slowOnly.detail, /outside the fast lane.*b\/heavy\.spec\.js.*--all or --slow/);
    const withSlow = await run(root, ['--related=b/heavy.spec.js', '--slow', '--json']);
    assert.equal(withSlow.status, STATUS.PASS);
    assert.equal(withSlow.totalTests, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('test lanes: --profile lists every spec of the lane with wall time and says how it measured', { timeout: 60000 }, async () => {
  const root = makeProject();
  try {
    const report = await run(root, ['--profile', '--all', '--json']);
    assert.equal(report.status, STATUS.PASS);
    assert.equal(report.profile.specCount, 3);
    assert.equal(report.profile.testCount, 4);
    assert.match(report.profile.method, /wall clock of each spec file/);
    const fastOnly = await run(root, ['--profile', '--json']);
    assert.deepEqual(fastOnly.profile.files.map((file) => file.spec).sort(), ['a/one.spec.js', 'a/two.spec.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
