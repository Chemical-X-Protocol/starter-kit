import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestAudit } from './test-audit.js';
import { STATUS } from './result-status.js';

const SPEC = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "test('adds', () => { assert.equal(1 + 1, 2); });",
  "test('guest login', () => { assert.equal(2, 2); });"
].join('\n');

const withNodeProject = async (scripts, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-audit-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'nt', type: 'module', scripts }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/a.spec.js'), SPEC);
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const run = (root, args) => runTestAudit([...args, '--json'], false, { cwd: root, print: false });

test('test-audit: `test <file> -t <name>` runs only the matching test', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node --test src/*.spec.js' }, async (root) => {
    const report = await run(root, ['src/a.spec.js', '-t', 'guest']);
    assert.equal(report.status, STATUS.PASS);
    assert.equal(report.passed, 1, report.command);
    assert.match(report.command, /--test-name-pattern="guest"/);
  });
});

test('test-audit: `-t=<name>` is a filter, not a literal "-t=..." value', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node --test src/*.spec.js' }, async (root) => {
    const report = await run(root, ['-t=adds']);
    assert.equal(report.passed, 1);
    assert.doesNotMatch(report.command, /-t=adds/);
  });
});

test('test-audit: a script whose glob collects zero tests is inconclusive with exit code 3 semantics', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node --test' }, async (root) => {
    const report = await run(root, []);
    assert.equal(report.status, STATUS.INCONCLUSIVE, `${report.command}: ${JSON.stringify(report)}`);
    assert.equal(report.reason, 'NO_TESTS_RAN');
    assert.equal(report.success, false);
  });
});

test('test-audit: --allow-empty accepts an empty run', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node --test' }, async (root) => {
    const report = await run(root, ['--allow-empty']);
    assert.equal(report.status, STATUS.PASS);
  });
});

test('test-audit: a filter that matches nothing is inconclusive, not "All tests passed"', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node --test src/*.spec.js' }, async (root) => {
    const report = await run(root, ['src/a.spec.js', '--filter=zzznomatch']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
  });
});

test('test-audit: an unknown flag is a usage error instead of being silently dropped', async () => {
  await withNodeProject({ test: 'node --test src/*.spec.js' }, async (root) => {
    const report = await run(root, ['--bogus']);
    assert.equal(report.status, STATUS.FAIL);
    assert.equal(report.reason, 'USAGE');
    assert.match(report.executionError, /unknown flag\(s\) --bogus/);
  });
});

test('test-audit: a run that exceeds --timeout is inconclusive STEP_TIMEOUT', { timeout: 60000 }, async () => {
  await withNodeProject({ test: 'node -e "setTimeout(() => {}, 30000)"' }, async (root) => {
    const report = await run(root, ['--timeout=0.5']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.equal(report.reason, 'STEP_TIMEOUT');
  });
});
