import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listWorkspacePackages } from './workspace.js';
import { findChemxDir } from './audit/chemx-dir.js';
import { runTestAudit } from './test-audit.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { runProjectVerify, runLintAudit } from './verify.js';
import { STATUS } from './result-status.js';

const KIT_NODE_MODULES = path.resolve(import.meta.dirname, '..', 'node_modules');
const NODE_SPEC = (from) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '${from}';\ntest('value', () => { assert.equal(value(), 1); });\n`;

// Three packages (node --test, vitest, node --test default globs), a negated glob, a root whose own
// test and typecheck scripts fail (so running them is visible), and a root .chemx.
const FILES = {
  'package.json': JSON.stringify({ name: 'mono', private: true, scripts: { test: 'node -e "process.exit(1)"', typecheck: 'node -e "process.exit(1)"' } }),
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/ignored'\n",
  'packages/alpha/package.json': JSON.stringify({ name: '@m/alpha', type: 'module', scripts: { test: 'node --test test/*.spec.js' } }),
  'packages/alpha/src/a.js': 'export const value = () => 1;\n',
  'packages/alpha/test/a.spec.js': NODE_SPEC('../src/a.js'),
  'packages/beta/package.json': JSON.stringify({ name: '@m/beta', type: 'module', scripts: { test: 'vitest run' }, devDependencies: { vitest: '*' } }),
  'packages/beta/src/b.js': 'export const value = () => 1;\n',
  'packages/beta/src/b.spec.js': "import { test, expect } from 'vitest';\nimport { value } from './b.js';\ntest('value', () => { expect(value()).toBe(1); });\n",
  'packages/gamma/package.json': JSON.stringify({ name: '@m/gamma', type: 'module', dependencies: { '@m/alpha': 'workspace:*' }, scripts: { test: 'node --test' } }),
  'packages/gamma/g.js': 'export const value = () => 1;\n',
  'packages/gamma/g.test.js': NODE_SPEC('./g.js'),
  'packages/ignored/package.json': JSON.stringify({ name: 'ignored', scripts: { test: 'node -e "process.exit(1)"' } })
};

const git = (root, ...args) => {
  const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

const withMonorepo = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mono-'));
  const previousRoot = process.env.CHEMX_PROJECT_ROOT;
  delete process.env.CHEMX_PROJECT_ROOT;
  try {
    for (const [rel, content] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    for (const dir of ['.', 'packages/alpha', 'packages/beta', 'packages/gamma']) fs.symlinkSync(KIT_NODE_MODULES, path.join(root, dir, 'node_modules'));
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.chemx\n');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    return await fn(root);
  } finally {
    const hadPreviousRoot = previousRoot !== undefined;
    if (hadPreviousRoot) process.env.CHEMX_PROJECT_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const quiet = (root) => ({ cwd: root, print: false });
const byPackage = (report) => Object.fromEntries(report.packages.map((p) => [p.package, p]));

test('workspace: packages come from pnpm-workspace.yaml globs, negations honoured', async () => {
  await withMonorepo((root) => {
    assert.deepEqual(listWorkspacePackages(root).map((p) => [p.name, p.rel]), [['@m/alpha', 'packages/alpha'], ['@m/beta', 'packages/beta'], ['@m/gamma', 'packages/gamma']]);
  });
});

test('workspace: test, typecheck and verify at the monorepo root run the root package only and name it', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    const reports = [
      await runTestAudit(['--json'], false, quiet(root)),
      await runTypecheckAudit(['--json'], false, quiet(root)),
      await runProjectVerify(['--json'], false, quiet(root))
    ];
    for (const report of reports) {
      assert.notEqual(report.reason, 'MONOREPO_ROOT', JSON.stringify(report));
      assert.deepEqual(report.packages.map((p) => [p.package, p.dir]), [['mono', '.']], 'only the root package ran');
      assert.match(report.notes.join(' '), /ran only the root package's own .*--all-packages/);
    }
    assert.equal(reports[0].status, STATUS.FAIL, 'the root test script (which fails here) was the one that ran');
  });
});

test('workspace: text-mode root verify names the audited dir and the excluded packages', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/r.js'), 'export const r = 1;\n');
    const cli = path.resolve(import.meta.dirname, 'index.js');
    const run = spawnSync(process.execPath, [cli, 'verify'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_NONINTERACTIVE: '1', NO_COLOR: '1' }, timeout: 110000 });
    assert.match(run.stdout, /audited src\/; not audited: .*packages\/alpha.*packages\/beta.*packages\/gamma.*--all-packages/, run.stdout);
  });
});

test('workspace: test --changed routes a root file to the root suite and a script-less package to a note', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    fs.mkdirSync(path.join(root, 'apps/x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/x/package.json'), JSON.stringify({ name: '@m/x', private: true }));
    fs.writeFileSync(path.join(root, 'apps/x/x.js'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - '!packages/ignored'\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'add app');
    fs.appendFileSync(path.join(root, 'apps/x/x.js'), '// changed\n');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/r.js'), 'export const r = 1;\n');
    git(root, 'add', '-A');
    const report = await runTestAudit(['--changed', '--json'], false, quiet(root));
    assert.deepEqual(report.packages.map((p) => p.package), ['mono'], JSON.stringify(report));
    assert.match(report.notes.join(' '), /@m\/x \(apps\/x\) changed but has no test script/);
    assert.match(report.notes.join(' '), /1 changed root file\(s\) were routed to the root package's suite/);
  });
});

test('workspace: lint and audit at the monorepo root refuse too', { timeout: 60000 }, async () => {
  await withMonorepo(async (root) => {
    const lint = await runLintAudit(['--json'], false, quiet(root));
    assert.equal(lint.reason, 'MONOREPO_ROOT', JSON.stringify(lint));
    const cli = path.resolve(import.meta.dirname, 'index.js');
    const audit = spawnSync(process.execPath, [cli, 'audit', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_NONINTERACTIVE: '1' }, timeout: 60000 });
    assert.equal(audit.status, 3, audit.stdout + audit.stderr);
    assert.equal(JSON.parse(audit.stdout).reason, 'MONOREPO_ROOT');
  });
});

test('workspace: test --all-packages runs each package with its own runner and combines the statuses', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    const report = await runTestAudit(['--all-packages', '--json'], false, quiet(root));
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report.packages.map((p) => [p.package, p.status, p.command])));
    const packages = byPackage(report);
    assert.deepEqual(Object.keys(packages), ['@m/alpha', '@m/beta', '@m/gamma']);
    assert.equal(packages['@m/alpha'].runner, 'node');
    assert.equal(packages['@m/beta'].runner, 'vitest');
    for (const entry of report.packages) assert.equal(entry.passed, 1, entry.package);
  });
});

test('workspace: targets in two packages run in those packages only', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    const report = await runTestAudit(['packages/alpha/test/a.spec.js', 'packages/beta/src/b.spec.js', '--json'], false, quiet(root));
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.deepEqual(report.packages.map((p) => p.package), ['@m/alpha', '@m/beta']);
  });
});

test('workspace: test --changed at the root maps changed files to their package and its affected specs', { timeout: 120000 }, async () => {
  await withMonorepo(async (root) => {
    fs.appendFileSync(path.join(root, 'packages/alpha/src/a.js'), '// changed\n');
    const report = await runTestAudit(['--changed', '--json'], false, quiet(root));
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.deepEqual(report.packages.map((p) => p.package), ['@m/alpha']);
    assert.deepEqual(report.packages[0].selection.specs.map((s) => s.path), ['test/a.spec.js']);
    assert.deepEqual(report.dependents.map((d) => d.package), ['@m/gamma'], 'workspace dependents are named, not silently skipped');
  });
});

test('workspace: verify --changed at the root verifies only the owning package', { timeout: 180000 }, async () => {
  await withMonorepo(async (root) => {
    fs.appendFileSync(path.join(root, 'packages/beta/src/b.js'), '// changed\n');
    const summary = await runProjectVerify(['--changed', '--json'], false, quiet(root));
    assert.deepEqual(summary.packages.map((p) => p.package), ['@m/beta']);
    assert.deepEqual(summary.packages[0].scope.files, ['src/b.js']);
  });
});

test('workspace: each package keeps its own index; the walk never climbs into the root or a parent checkout', async () => {
  await withMonorepo((root) => {
    assert.equal(findChemxDir(path.join(root, 'packages/beta/src')), path.join(root, 'packages/beta', '.chemx'));
    assert.equal(findChemxDir(path.join(root, 'tools')), path.join(root, '.chemx'), 'a plain subdirectory still uses the root index');
    const nested = path.join(root, 'vendor-checkout');
    fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
    assert.equal(findChemxDir(path.join(nested, 'src')), path.join(nested, '.chemx'), 'a nested git checkout gets its own index');
  });
});
