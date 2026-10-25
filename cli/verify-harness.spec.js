// chemx verify in a repo with its own tests/run-tests.mjs harness runner and no package.json (task #6770):
// the WordPress plugins. It runs php -l, the runner and the audit instead of demanding node_modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProjectVerify } from './verify.js';
import { formatVerifyLine } from './verify-changed.js';
import { ENV } from './job-line-spec-helpers.js';
import { withHarnessRepo, commitAll, suiteOf, PHP_CLEAN, PHP_BROKEN } from './fixtures/project-runner/harness-repo.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const HAS_PHP = spawnSync('php', ['-v']).status === 0;
const NEEDS_PHP = HAS_PHP ? false : 'php is not on PATH';
// The default fixture's beta suite has one failing test; this one passes.
const GREEN = { 'tests/beta.test.mjs': suiteOf('beta', 3) };

// A repo, a private job line, and verify wired to both.
const inRepo = (body, extra = {}) => withHarnessRepo(async (paths) => {
  const slots = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-verify-harness-slots-'));
  try {
    const env = { ...ENV, CHEMX_TEST_SLOTS_DIR: slots };
    const verify = (args = [], options = {}) => runProjectVerify([...args, '--json'], false, { cwd: paths.repo, env, print: false, onWait: () => {}, ...options });
    await body({ ...paths, slots, env, verify });
  } finally {
    fs.rmSync(slots, { recursive: true, force: true });
  }
}, extra);

const write = (repo, name, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), content);
};

test('verify: a harness repo with no package.json and no node_modules runs the three gates instead of demanding node_modules', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ repo, slots, verify }) => {
    commitAll(repo);
    write(repo, 'includes/clean.php', PHP_CLEAN);
    assert.equal(fs.existsSync(path.join(repo, 'package.json')), false);
    assert.equal(fs.existsSync(path.join(repo, 'node_modules')), false);
    const summary = await verify();
    assert.equal(summary.status, 'pass', JSON.stringify(summary));
    assert.equal(summary.success, true);
    assert.equal(summary.phpLint.status, 'pass');
    assert.equal(summary.phpLint.checked, 1);
    assert.equal(summary.tests.status, 'pass');
    assert.equal(summary.tests.command, 'node tests/run-tests.mjs');
    assert.equal(summary.tests.passed, 6);
    assert.ok(summary.audit, 'the audit still runs');
    assert.equal(summary.typecheck, undefined, 'there is nothing to typecheck');
    assert.ok(fs.readdirSync(slots).includes('seq'), 'the runner took a ticket in the job line it was given');
    assert.doesNotMatch(JSON.stringify(summary), /node_modules/);
  }, GREEN);
});

test('verify: a PHP syntax error fails the run and names file and line; the other gates still report', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ repo, verify }) => {
    commitAll(repo);
    write(repo, 'includes/broken.php', PHP_BROKEN);
    const summary = await verify();
    assert.equal(summary.status, 'fail');
    assert.equal(summary.success, false);
    assert.equal(summary.phpLint.status, 'fail');
    assert.equal(summary.phpLint.errors[0].file, 'includes/broken.php');
    assert.equal(summary.phpLint.errors[0].line, 2);
    assert.equal(summary.tests.status, 'pass');
    assert.match(summary.architecturalWarning, /Not proven: php -l \(fail\)/);
  }, GREEN);
});

test('verify: a failing harness test fails the run while php -l passes', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ repo, verify }) => {
    commitAll(repo);
    write(repo, 'includes/clean.php', PHP_CLEAN);
    const summary = await verify();
    assert.equal(summary.phpLint.status, 'pass');
    assert.equal(summary.tests.status, 'fail');
    assert.equal(summary.tests.failed, 1);
    assert.equal(summary.status, 'fail');
  });
});

test('verify: php-l reads the changed files; --all reads every PHP file', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ repo, verify }) => {
    write(repo, 'includes/old-broken.php', PHP_BROKEN);
    commitAll(repo);
    write(repo, 'includes/clean.php', PHP_CLEAN);
    const changed = await verify();
    assert.equal(changed.phpLint.status, 'pass');
    assert.equal(changed.phpLint.checked, 1);
    const all = await verify(['--all']);
    assert.equal(all.phpLint.status, 'fail');
    assert.equal(all.phpLint.checked, 2);
    assert.equal(all.status, 'fail');
  }, GREEN);
});

test('verify --changed --base: the PHP files changed since that revision are linted', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ repo, verify }) => {
    const git = commitAll(repo);
    write(repo, 'includes/broken.php', PHP_BROKEN);
    git('add', '-A');
    git('commit', '-q', '-m', 'broken');
    assert.equal((await verify(['--changed'])).phpLint.checked, 0, 'vs HEAD nothing changed');
    const since = await verify(['--changed', '--base=HEAD~1']);
    assert.equal(since.phpLint.status, 'fail');
    assert.equal(since.tests.command, 'node tests/run-tests.mjs', '--changed never narrows the runner');
    assert.equal(since.tests.passed, 6);
    assert.equal(since.scope.base.length > 0, true);
  }, GREEN);
});

test('verify: without php on PATH the lint step is skipped in one line and the other gates decide', async () => {
  await inRepo(async ({ repo, verify }) => {
    write(repo, 'includes/broken.php', PHP_BROKEN);
    commitAll(repo);
    const summary = await verify(['--all'], { phpBinary: 'chemx-no-such-php-binary' });
    assert.equal(summary.phpLint.status, 'skipped');
    assert.match(summary.phpLint.note, /php is not on PATH/);
    assert.equal(summary.tests.status, 'pass');
    assert.equal(summary.status, 'pass', 'a skipped gate neither passes nor fails the run');
  }, GREEN);
});

test('verify: runs from inside tests/ and under a parent that has its own package.json', { skip: NEEDS_PHP }, async () => {
  await inRepo(async ({ plugins, repo, tests, verify }) => {
    fs.writeFileSync(path.join(plugins, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    commitAll(repo);
    write(repo, 'includes/broken.php', PHP_BROKEN);
    const summary = await verify([], { cwd: tests });
    assert.equal(summary.phpLint.status, 'fail');
    assert.equal(summary.phpLint.errors[0].file, 'includes/broken.php');
    assert.equal(summary.tests.command, 'node tests/run-tests.mjs');
  }, GREEN);
});

test('verify --all: refused in a project that is not a harness repo, since it would silently do nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-verify-all-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"p"}');
    fs.mkdirSync(path.join(root, 'node_modules'));
    const summary = await runProjectVerify(['--all', '--json'], false, { cwd: root, print: false });
    assert.equal(summary.status, 'fail');
    assert.match(summary.error, /--all/);
    assert.match(summary.error, /tests\/run-tests\.mjs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formatVerifyLine: a package that ran php -l names its three gates, not a typecheck', () => {
  const line = formatVerifyLine({ status: 'fail', phpLint: { status: 'fail' }, tests: { status: 'pass' }, audit: { status: 'pass' }, scope: { dir: '.' } });
  assert.match(line, /\(phpLint fail, tests pass, audit pass\)/);
  assert.doesNotMatch(line, /typecheck/);
  assert.match(formatVerifyLine({ status: 'pass', audit: { status: 'pass' }, typecheck: { status: 'skipped' }, tests: { status: 'pass' }, scope: { dir: '.' } }), /\(audit pass, typecheck skipped, tests pass\)/);
});

// The real thing: the CLI, text output, the exit code.
const cli = (repo, slots, args = []) => spawnSync(process.execPath, [CLI, 'verify', ...args], {
  cwd: repo, encoding: 'utf8', timeout: 120000,
  env: { ...process.env, ...ENV, CHEMX_TEST_SLOTS_DIR: slots, CHEMX_AGENT_ID: '' }
});

test('chemx verify (CLI): names the three gates, exits 1 on the worst of them, 0 when all pass', { skip: NEEDS_PHP, timeout: 120000 }, async () => {
  await inRepo(async ({ repo, slots }) => {
    commitAll(repo);
    write(repo, 'includes/clean.php', PHP_CLEAN);
    const green = cli(repo, slots);
    assert.equal(green.status, 0, green.stdout + green.stderr);
    for (const gate of ['PHP syntax', 'Test Suite', 'AST Architecture']) assert.ok(green.stdout.includes(gate), `${gate} in:\n${green.stdout}`);
    assert.match(green.stdout, /All verification checks passed/);

    write(repo, 'includes/broken.php', PHP_BROKEN);
    const red = cli(repo, slots);
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /includes\/broken\.php:2/);
    assert.match(red.stdout, /Verification failed/);
    assert.doesNotMatch(red.stdout + red.stderr, /Missing node_modules/);
  }, GREEN);
});
