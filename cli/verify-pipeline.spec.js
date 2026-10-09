import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProjectVerify } from './verify.js';
import { runBuildAudit } from './build.js';
import { STATUS } from './result-status.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const ONE_TEST = "import test from 'node:test';\ntest('ok', () => {});\n";

const withProject = async (scripts, fn, { testFile = 'src/a.test.js' } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-verify-pipe-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bp', type: 'module', scripts }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/index.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, testFile), ONE_TEST);
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const verify = (root, args) => runProjectVerify([...args, '--json'], false, { cwd: root, print: false });
const PASSING = { test: 'node --test', build: 'node -e "console.log(1)"' };

test('verify --build: a passing build is reported as passing and the whole run passes', { timeout: 120000 }, async () => {
  await withProject(PASSING, async (root) => {
    const summary = await verify(root, ['--build']);
    assert.equal(summary.build.status, STATUS.PASS, JSON.stringify(summary.build));
    assert.equal(summary.build.success, true);
    assert.equal(summary.typecheck.status, 'skipped');
    assert.equal(summary.status, STATUS.PASS, JSON.stringify(summary));
    assert.equal(summary.architecturalWarning, null);
  });
});

test('verify --build: a failing build fails verify and the warning names the build, not typecheck/tests', { timeout: 120000 }, async () => {
  await withProject({ ...PASSING, build: 'node -e "process.exit(2)"' }, async (root) => {
    const summary = await verify(root, ['--build']);
    assert.equal(summary.build.status, STATUS.FAIL);
    assert.equal(summary.status, STATUS.FAIL);
    assert.match(summary.architecturalWarning, /Not proven: build \(fail\)/);
  });
});

test('verify: zero collected tests make verify inconclusive, never "All verification checks passed"', { timeout: 120000 }, async () => {
  await withProject(PASSING, async (root) => {
    const summary = await verify(root, []);
    assert.equal(summary.tests.status, STATUS.INCONCLUSIVE);
    assert.equal(summary.tests.reason, 'NO_TESTS_RAN');
    assert.equal(summary.status, STATUS.INCONCLUSIVE);
    assert.equal(summary.success, false);
  }, { testFile: 'src/a.spec.js' });
});

test('verify: a step that exceeds the per-step timeout is inconclusive and verify still returns', { timeout: 120000 }, async () => {
  await withProject({ test: 'node -e "setTimeout(() => {}, 60000)"' }, async (root) => {
    const summary = await verify(root, ['--timeout=1']);
    assert.equal(summary.tests.status, STATUS.INCONCLUSIVE);
    assert.equal(summary.tests.reason, 'STEP_TIMEOUT');
    assert.equal(summary.status, STATUS.INCONCLUSIVE);
  });
});

test('build: --command="<cmd>", --command <cmd> and -- <cmd> are all honored', { timeout: 60000 }, async () => {
  await withProject(PASSING, async (root) => {
    for (const args of [['--command=exit 3'], ['--command', 'exit 3'], ['--', 'exit', '3']]) {
      const report = await runBuildAudit(['--json', ...args], false, { cwd: root, print: false });
      assert.equal(report.command, 'exit 3', args.join(' '));
      assert.equal(report.status, STATUS.FAIL);
      assert.equal(report.exitCode, 3);
    }
  });
});

test('build: unknown flags are rejected instead of running the default build', async () => {
  await withProject(PASSING, async (root) => {
    const report = await runBuildAudit(['--json', '--comand=exit 3'], false, { cwd: root, print: false });
    assert.equal(report.status, STATUS.FAIL);
    assert.match(report.executionError, /unknown flag/);
  });
});

test('build: a failing user build run non-interactively prints no issue URL and writes no issue file', { timeout: 60000 }, async () => {
  await withProject(PASSING, async (root) => {
    const result = spawnSync(process.execPath, [CLI, 'build', '--', 'exit', '3'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /issues\/new|Prepped Issue/);
    assert.equal(fs.existsSync(path.join(root, '.chemx', 'issues')), false);
  });
});
