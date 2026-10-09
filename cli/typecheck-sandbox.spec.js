// `chemx typecheck --sandbox`: the piece below is the body of cli/doctor/check-host.js:15-21
// (readJsonOrEmpty) generalized with a fallback parameter, which is the A7 extraction target.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSandboxTypecheck, planSandboxTypecheck, buildSandboxTsconfig, SANDBOX_REASONS } from './typecheck-sandbox.js';
import { STATUS } from './result-status.js';
import { runTypecheckAudit } from './typecheck-audit.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPED_PIECE = [
  "import fs from 'node:fs';",
  '',
  '/**',
  ' * @param {string} file',
  ' * @param {unknown} fallback',
  ' * @returns {unknown}',
  ' */',
  'export const readJsonOr = (file, fallback) => {',
  '  try {',
  "    return JSON.parse(fs.readFileSync(file, 'utf-8'));",
  '  } catch {',
  '    return fallback;',
  '  }',
  '};',
  ''
].join('\n');

const UNTYPED_PIECE = TYPED_PIECE.replace(/\/\*\*[\s\S]*?\*\/\n/, '');

const withSandbox = async (source, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sandbox-spec-'));
  try {
    fs.writeFileSync(path.join(dir, 'read-json-or.js'), source);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('sandbox typecheck passes on a JSDoc-typed readJsonOr under checkJs strict', async () => {
  await withSandbox(TYPED_PIECE, async (dir) => {
    const report = await runSandboxTypecheck(dir, { cwd: KIT_ROOT });
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report.errors));
    assert.equal(report.errorCount, 0);
  });
});

test('sandbox typecheck fails with TS7006 on an untyped copy', async () => {
  await withSandbox(UNTYPED_PIECE, async (dir) => {
    const report = await runSandboxTypecheck(dir, { cwd: KIT_ROOT });
    assert.equal(report.status, STATUS.FAIL);
    assert.ok(report.errors.some((err) => err.code === 'TS7006'), JSON.stringify(report.errors));
  });
});

test('sandbox plan leaves no project tsconfig change and cleans its temp config', async () => {
  await withSandbox(TYPED_PIECE, async (dir) => {
    const plan = planSandboxTypecheck(dir, { cwd: KIT_ROOT });
    assert.ok(fs.existsSync(plan.tsconfigPath));
    assert.ok(!plan.tsconfigPath.startsWith(KIT_ROOT));
    plan.cleanup();
    assert.ok(!fs.existsSync(plan.tsconfigPath));
  });
});

test('sandbox reports inconclusive for a missing or empty directory', () => {
  const missing = planSandboxTypecheck('no-such-sandbox-dir', { cwd: KIT_ROOT });
  assert.equal(missing.status, STATUS.INCONCLUSIVE);
  assert.equal(missing.reason, SANDBOX_REASONS.SANDBOX_MISSING);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sandbox-empty-'));
  try {
    assert.equal(planSandboxTypecheck(empty, { cwd: KIT_ROOT }).reason, SANDBOX_REASONS.SANDBOX_EMPTY);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('CLI path: --no-checkjs reaches the sandbox, default still checks JS', async () => {
  await withSandbox(UNTYPED_PIECE, async (dir) => {
    const run = (extra) => runTypecheckAudit([`--sandbox=${dir}`, '--json', ...extra], false, { cwd: KIT_ROOT, print: false });
    const checked = await run([]);
    assert.equal(checked.status, STATUS.FAIL);
    const skipped = await run(['--no-checkjs']);
    assert.equal(skipped.status, STATUS.PASS, JSON.stringify(skipped.errors));
  });
});

test('sandbox tsconfig is strict and honours checkJs', () => {
  const config = buildSandboxTsconfig('/x', { checkJs: false });
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.checkJs, false);
});
