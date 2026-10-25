/**
 * chemx test names an unsplit zsh variable (#6773): `chemx test $specs` hands zsh's one joined string
 * to the runner, and "target(s) matched nothing: a.spec.js b.spec.js" blamed the specs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestAudit } from './test-audit.js';
import { STATUS } from './result-status.js';
import { UNSPLIT_HINT } from './args-unsplit-hint.js';

const SPEC = "import test from 'node:test';\ntest('adds', () => {});\n";

const withNodeProject = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-unsplit-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'nt', type: 'module', scripts: { test: 'node --test src/*.spec.js' } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'src'));
    for (const name of ['a.spec.js', 'b.spec.js', 'my spec.spec.js']) fs.writeFileSync(path.join(root, 'src', name), SPEC);
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const run = (root, args) => runTestAudit([...args, '--json'], false, { cwd: root, print: false });

test('one joined argument for two real specs is inconclusive and carries the zsh hint once', { timeout: 60000 }, async () => {
  await withNodeProject(async (root) => {
    const report = await run(root, ['src/a.spec.js src/b.spec.js']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.match(report.detail, /target\(s\) matched nothing: src\/a\.spec\.js src\/b\.spec\.js/);
    assert.equal(report.detail.split(UNSPLIT_HINT).length - 1, 1, report.detail);
  });
});

test('a missing spec with no spaces keeps the plain detail, no hint', { timeout: 60000 }, async () => {
  await withNodeProject(async (root) => {
    const report = await run(root, ['src/nope.spec.js']);
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.ok(!report.detail.includes('zsh'), report.detail);
  });
});

test('a spec whose name has a space runs and gets no hint', { timeout: 60000 }, async () => {
  await withNodeProject(async (root) => {
    const report = await run(root, ['src/my spec.spec.js']);
    assert.notEqual(report.status, STATUS.INCONCLUSIVE, JSON.stringify(report));
    assert.ok(!String(report.detail ?? '').includes('zsh'));
  });
});
