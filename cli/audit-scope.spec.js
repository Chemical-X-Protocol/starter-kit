import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveAuditScope } from './audit-scope.js';
import { runProjectVerify } from './verify.js';

const makeProject = ({ dirs = [], chemxrc = null } = {}) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-scope-')));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'scope-fixture' }));
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  if (chemxrc) fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify(chemxrc));
  return root;
};

const withProject = async (options, fn) => {
  const root = makeProject(options);
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('audit scope: explicit dir wins over config scope', async () => {
  await withProject({ dirs: ['src', 'cli'], chemxrc: { scope: 'cli' } }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root, explicitDir: 'src' });
    assert.strictEqual(scope.ok, true);
    assert.strictEqual(scope.source, 'explicit');
    assert.strictEqual(scope.relDir, 'src');
    assert.strictEqual(scope.dir, path.join(root, 'src'));
  });
});

test('audit scope: config scope is used when no explicit dir', async () => {
  await withProject({ dirs: ['src', 'cli'], chemxrc: { scope: 'cli' } }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root });
    assert.strictEqual(scope.source, 'config');
    assert.strictEqual(scope.relDir, 'cli');
  });
});

test('audit scope: single candidate audits project root', async () => {
  await withProject({ dirs: ['src'] }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root });
    assert.strictEqual(scope.source, 'root');
    assert.strictEqual(scope.relDir, '.');
    assert.strictEqual(scope.dir, root);
  });
});

test('audit scope: multiple candidates without config refuses', async () => {
  await withProject({ dirs: ['src', 'cli'] }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root });
    assert.strictEqual(scope.ok, false);
    assert.strictEqual(scope.reason, 'ambiguous');
    assert.deepStrictEqual(scope.candidates, ['cli', 'src']);
  });
});

test('audit scope: config scope naming a missing directory refuses', async () => {
  await withProject({ dirs: ['src'], chemxrc: { scope: 'nope' } }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root });
    assert.strictEqual(scope.ok, false);
    assert.strictEqual(scope.reason, 'missing');
    assert.ok(scope.message.includes('nope'));
  });
});

test('audit scope: explicit dir that does not exist refuses', async () => {
  await withProject({ dirs: ['src'] }, (root) => {
    const scope = resolveAuditScope({ projectRoot: root, explicitDir: 'ghost' });
    assert.strictEqual(scope.reason, 'missing');
  });
});

test('audit scope: verify refuses ambiguous scope and runs no checks', async () => {
  await withProject({ dirs: ['src', 'cli', 'node_modules'] }, async (root) => {
    const summary = await runProjectVerify(['--json'], false, { cwd: root, print: false });
    assert.strictEqual(summary.success, false);
    assert.deepStrictEqual(summary.scope.candidates, ['cli', 'src']);
    assert.strictEqual(summary.typecheck, undefined);
  });
});

test('audit scope: cli audit --git audits the change set even when scope is ambiguous', async () => {
  await withProject({ dirs: ['src', 'cli'] }, async (root) => {
    const { execSync } = await import('node:child_process');
    const { runAudit } = await import('./commands/cmd-audit.js');
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
    execSync('git init -q && git add -A', { cwd: root });
    const original = process.cwd();
    const originalWrite = process.stdout.write;
    try {
      process.chdir(root);
      process.stdout.write = () => true;
      const report = await runAudit(undefined, false, ['--json', '--git'], () => ({}));
      process.stdout.write = originalWrite;
      assert.notStrictEqual(report.success, false, report.error);
      assert.ok(report.health);
    } finally {
      process.stdout.write = originalWrite;
      process.chdir(original);
    }
  });
});

test('audit scope: verify resolves a monorepo --dir once, from the caller directory', async () => {
  await withProject({ dirs: ['packages/a/src', 'node_modules'] }, async (root) => {
    fs.writeFileSync(path.join(root, 'packages/a/package.json'), JSON.stringify({ name: 'a', scripts: { test: 'node -e ""', typecheck: 'node -e ""' } }));
    fs.mkdirSync(path.join(root, 'packages/a/node_modules'));
    fs.writeFileSync(path.join(root, 'packages/a/src/x.js'), 'export const x = 1;\n');
    const summary = await runProjectVerify(['--json', '--dir=packages/a/src'], false, { cwd: root, print: false });
    assert.deepStrictEqual(summary.scope, { dir: 'src', source: 'explicit' });
  });
});

test('audit scope: verify names what typecheck and tests ran, since only the audit is scoped', async () => {
  await withProject({ dirs: ['src', 'node_modules'] }, async (root) => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node -e ""', typecheck: 'node -e ""' } }));
    fs.writeFileSync(path.join(root, 'src/x.js'), 'export const x = 1;\n');
    const summary = await runProjectVerify(['--json'], false, { cwd: root, print: false });
    assert.match(summary.typecheck.command, /typecheck/);
    assert.match(summary.tests.command, /test/);
  });
});
