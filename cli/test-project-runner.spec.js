// chemx test in a repo with its own tests/run-tests.mjs (task #6754): one file runs through a
// generated copy of the runner, the whole runner runs as it is, both inside the job line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRunner } from './build/detector.js';
import { buildRunnerSource, planProjectRunner, GENERATED_PREFIX, sweepGeneratedRunners } from './test-project-runner.js';
import { runTestAudit } from './test-audit.js';
import { runWithinBudget } from './test-run.js';
import { ENV } from './job-line-spec-helpers.js';
import { RUNNER, withHarnessRepo } from './fixtures/project-runner/harness-repo.js';

const generated = (tests) => fs.readdirSync(tests).filter((name) => name.startsWith(GENERATED_PREFIX));

// A repo, the project runner found in it, and a private slot dir.
const inRepo = (body, extra) => withHarnessRepo(async (paths) => {
  const slots = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-harness-slots-'));
  try {
    const env = { ...ENV, CHEMX_TEST_SLOTS_DIR: slots };
    await body({ ...paths, slots, env, project: findProjectRunner(paths.repo) });
  } finally {
    fs.rmSync(slots, { recursive: true, force: true });
  }
}, extra);

const audit = (args, { repo, env }) => runTestAudit([...args, '--json'], false, { cwd: repo, env, print: false, onWait: () => {} });

test('buildRunnerSource: swaps the test-file imports for the given ones and keeps the rest of the runner', () => {
  const source = buildRunnerSource(RUNNER, { imports: ['./alpha.test.mjs'] });
  assert.match(source, /import '\.\/alpha\.test\.mjs';/);
  assert.doesNotMatch(source, /beta\.test\.mjs|gamma\.test\.mjs/);
  assert.match(source, /import \{ harness \} from '\.\.\/\.\.\/xophz-compass/);
  assert.match(source, /const results = await harness\.run\(\);/);
});

test('buildRunnerSource: a name filter keeps every import and narrows the suites after they registered', () => {
  const source = buildRunnerSource(RUNNER, { imports: null, filter: 'alpha case 1' });
  assert.match(source, /beta\.test\.mjs/);
  assert.match(source, /harness\.suites/);
  assert.ok(source.indexOf('harness.suites') > source.indexOf('gamma.test.mjs'));
  assert.match(source, /new RegExp\("alpha case 1"\)/);
});

test('buildRunnerSource: a filter that is not a regular expression is matched as plain text', () => {
  const source = buildRunnerSource(RUNNER, { imports: null, filter: 'adds (one' });
  assert.match(source, /new RegExp\("adds \\\\\(one"\)/);
});

test('planProjectRunner: no targets and no filter runs the repo runner as it is, nothing generated', async () => {
  await inRepo(({ project, tests }) => {
    const plan = planProjectRunner(project, {});
    assert.equal(plan.command, 'node tests/run-tests.mjs');
    assert.equal(plan.runner, 'harness');
    assert.equal(plan.cwd, project.root);
    assert.equal(plan.exclusive, true);
    assert.equal(plan.prepare, undefined);
    assert.deepEqual(generated(tests), []);
  });
});

test('planProjectRunner: a file target runs a generated one-file runner inside tests/, written on prepare and gone after', async () => {
  await inRepo(({ project, tests }) => {
    const plan = planProjectRunner(project, { targets: ['tests/alpha.test.mjs'] });
    assert.match(plan.command, /^node tests\/\.chemx-run-[0-9a-f]{8}\.mjs$/);
    assert.deepEqual(plan.missingTargets, []);
    assert.deepEqual(generated(tests), [], 'planning writes nothing');
    const cleanup = plan.prepare();
    const [name] = generated(tests);
    const source = fs.readFileSync(path.join(tests, name), 'utf8');
    assert.match(source, /import '\.\/alpha\.test\.mjs';/);
    assert.doesNotMatch(source, /beta/);
    cleanup();
    assert.deepEqual(generated(tests), []);
  });
});

test('planProjectRunner: the same request gets the same generated name, so two callers can share a run', async () => {
  await inRepo(({ project }) => {
    const first = planProjectRunner(project, { targets: ['tests/alpha.test.mjs'] });
    const again = planProjectRunner(project, { targets: ['tests/alpha.test.mjs'] });
    const other = planProjectRunner(project, { targets: ['tests/beta.test.mjs'] });
    assert.equal(first.command, again.command);
    assert.notEqual(first.command, other.command);
  });
});

test('planProjectRunner: a directory target becomes the test files inside it, a target outside tests/ climbs out', async () => {
  await inRepo(({ project, tests }) => {
    const plan = planProjectRunner(project, { targets: ['tests/sub'] });
    plan.prepare()();
    assert.deepEqual(plan.targets, ['tests/sub/gamma.test.mjs']);
    fs.mkdirSync(path.join(project.root, 'other'));
    fs.writeFileSync(path.join(project.root, 'other', 'delta.test.mjs'), '');
    const outside = planProjectRunner(project, { targets: ['other/delta.test.mjs'] });
    const cleanup = outside.prepare();
    assert.match(fs.readFileSync(path.join(tests, generated(tests)[0]), 'utf8'), /import '\.\.\/other\/delta\.test\.mjs';/);
    cleanup();
  });
});

test('planProjectRunner: targets that do not exist come back as missing, never silently dropped', async () => {
  await inRepo(({ project }) => {
    const plan = planProjectRunner(project, { targets: ['tests/alpha.test.mjs', 'tests/nope.test.mjs', 'tests/empty'] });
    assert.deepEqual(plan.missingTargets, ['tests/nope.test.mjs', 'tests/empty']);
  });
});

test('planProjectRunner: a target relative to where the caller stands resolves there first', async () => {
  await inRepo(({ project, tests }) => {
    const plan = planProjectRunner(project, { targets: ['alpha.test.mjs'], fromDir: tests });
    assert.deepEqual(plan.missingTargets, []);
    assert.deepEqual(plan.targets, ['tests/alpha.test.mjs']);
  });
});

test('sweepGeneratedRunners: leftovers older than the window go, fresh ones and real tests stay', async () => {
  await inRepo(({ tests }) => {
    const stale = path.join(tests, `${GENERATED_PREFIX}00000000.mjs`);
    const fresh = path.join(tests, `${GENERATED_PREFIX}11111111.mjs`);
    fs.writeFileSync(stale, '');
    fs.writeFileSync(fresh, '');
    const old = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(stale, old, old);
    sweepGeneratedRunners(tests);
    assert.deepEqual(generated(tests), [path.basename(fresh)]);
    assert.ok(fs.existsSync(path.join(tests, 'alpha.test.mjs')));
  });
});

test('chemx test <file>: only that file runs, the verdict is one line, the generated runner is gone', async () => {
  await inRepo(async (paths) => {
    const report = await audit(['tests/alpha.test.mjs'], paths);
    assert.equal(report.status, 'pass');
    assert.equal(report.runner, 'harness');
    assert.equal(report.passed, 2, 'alpha has two tests, the runner has six');
    assert.equal(report.failed, 0);
    assert.deepEqual(generated(paths.tests), []);
  });
});

test('chemx test <file>: a failing file reports the failing test by name and nothing else', async () => {
  await inRepo(async (paths) => {
    const report = await audit(['tests/beta.test.mjs'], paths);
    assert.equal(report.status, 'fail');
    assert.equal(report.failed, 1);
    assert.equal(report.passed, 3);
    assert.deepEqual(report.failures.map((failure) => failure.name), ['beta > beta breaks']);
    assert.deepEqual(generated(paths.tests), [], 'cleaned up after a failure too');
  });
});

test('chemx test: no arguments runs the whole repo runner', async () => {
  await inRepo(async (paths) => {
    const report = await audit([], paths);
    assert.equal(report.command, 'node tests/run-tests.mjs');
    assert.equal(report.passed, 6);
    assert.equal(report.failed, 1);
  });
});

test('chemx test -t <name>: narrows the runner to the tests whose name matches', async () => {
  await inRepo(async (paths) => {
    const report = await audit(['tests/beta.test.mjs', '-t', 'beta case 2'], paths);
    assert.equal(report.status, 'pass');
    assert.equal(report.passed, 1);
  });
});

test('chemx test: a name that matches no test is inconclusive, not a pass', async () => {
  await inRepo(async (paths) => {
    const report = await audit(['-t', 'no such test'], paths);
    assert.equal(report.status, 'inconclusive');
  });
});

test('chemx test <missing file>: inconclusive with the target named, nothing ran', async () => {
  await inRepo(async (paths) => {
    const report = await audit(['tests/nope.test.mjs'], paths);
    assert.equal(report.status, 'inconclusive');
    assert.match(report.detail, /tests\/nope\.test\.mjs/);
  });
});

test('chemx test: no node_modules is needed, the harness has no dependencies', async () => {
  await inRepo(async (paths) => {
    assert.equal(fs.existsSync(path.join(paths.repo, 'node_modules')), false);
    const report = await audit(['tests/alpha.test.mjs'], paths);
    assert.equal(report.status, 'pass');
  });
});

test('chemx test: runs from inside tests/ and from a plugin dir below a parent that has its own package.json', async () => {
  await inRepo(async (paths) => {
    fs.writeFileSync(path.join(paths.plugins, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    const fromTests = await audit(['alpha.test.mjs'], { ...paths, repo: paths.tests });
    assert.equal(fromTests.status, 'pass');
    assert.equal(fromTests.passed, 2);
  });
});

// A stand-in runner command that records when it started and ended, to see whether two runs overlapped.
const stamped = (log, label) => `node -e "const fs=require('fs');fs.appendFileSync('${log}','${label}:start\\n');setTimeout(()=>{fs.appendFileSync('${log}','${label}:end\\n')},300)"`;
const exclusivePlan = (project, command, extra = {}) => ({ command, cwd: project.root, runner: 'harness', missingTargets: [], targets: ['tests/alpha.test.mjs'], exclusive: true, ...extra });

test('a harness run takes a ticket in the job line even when it names one file; a light run does not', async () => {
  await inRepo(async ({ project, slots, env }) => {
    const listing = `node -e "console.log(require('fs').readdirSync('${slots}').join(' '))"`;
    const exclusive = await runWithinBudget(exclusivePlan(project, listing), { env, onWait: () => {} });
    assert.match(exclusive.execution.stdout, /ticket-1/);
    const light = await runWithinBudget(exclusivePlan(project, listing, { exclusive: false }), { env, onWait: () => {} });
    assert.doesNotMatch(light.execution.stdout, /ticket-/);
  });
});

test('two harness runs started together take turns: the second starts after the first ended', async () => {
  await inRepo(async ({ project, slots, env }) => {
    const log = path.join(slots, 'order.log');
    const runs = ['one', 'two'].map((label) => runWithinBudget(exclusivePlan(project, stamped(log, label)), { env, onWait: () => {} }));
    await Promise.all(runs);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    const [first] = lines[0].split(':');
    assert.deepEqual(lines, [`${first}:start`, `${first}:end`, `${first === 'one' ? 'two' : 'one'}:start`, `${first === 'one' ? 'two' : 'one'}:end`]);
  });
});
