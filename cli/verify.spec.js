import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectTypecheckCommand,
  detectTestCommand,
  parseTypecheckOutput,
  parseTestOutput,
  runTypecheckAudit,
  runTestAudit,
  runProjectVerify
} from './verify.js';

test('Verify: detectTypecheckCommand resolves custom command when provided', () => {
  const cmd = detectTypecheckCommand('pnpm custom:typecheck');
  assert.strictEqual(cmd, 'pnpm custom:typecheck');
});

test('Verify: detectTypecheckCommand falls back to tsc or package script', () => {
  const cmd = detectTypecheckCommand(null, process.cwd());
  assert.ok(cmd.includes('typecheck') || cmd.includes('tsc'));
});

test('Verify: detectTestCommand resolves custom test command when provided', () => {
  const cmd = detectTestCommand('vitest run test/unit');
  assert.strictEqual(cmd, 'vitest run test/unit');
});

test('Verify: parseTypecheckOutput extracts clean structured diagnostics', () => {
  const sampleOutput = `
src/components/Card.tsx(14,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils/api.ts:25:10 - error TS2304: Cannot find name 'fetchUser'.
`;
  const errors = parseTypecheckOutput(sampleOutput, '');
  assert.strictEqual(errors.length, 2);
  assert.strictEqual(errors[0].file, 'src/components/Card.tsx');
  assert.strictEqual(errors[0].line, 14);
  assert.strictEqual(errors[0].column, 5);
  assert.strictEqual(errors[0].code, 'TS2322');

  assert.strictEqual(errors[1].file, 'src/utils/api.ts');
  assert.strictEqual(errors[1].line, 25);
  assert.strictEqual(errors[1].code, 'TS2304');
});

test('Verify: parseTypecheckOutput returns empty array when clean', () => {
  const cleanOutput = `
> tsc --noEmit
Done in 2.4s.
`;
  const errors = parseTypecheckOutput(cleanOutput, '');
  assert.strictEqual(errors.length, 0);
});

test('Verify: parseTestOutput strips passing checkmarks and extracts only failing tests', () => {
  const sampleTestOutput = `
✔ should render header (2.4ms)
✔ should handle button click (5.1ms)
✖ should submit form successfully
  AssertionError [ERR_ASSERTION]: Expected true to be false
    at Context.<anonymous> (test/form.spec.js:42:10)
✔ should toggle modal (1.2ms)
ℹ tests 4
ℹ pass 3
ℹ fail 1
`;
  const parsed = parseTestOutput(sampleTestOutput, '', 1);
  assert.strictEqual(parsed.success, false);
  assert.strictEqual(parsed.totalTests, 4);
  assert.strictEqual(parsed.passed, 3);
  assert.strictEqual(parsed.failed, 1);
  assert.strictEqual(parsed.failures.length, 1);
  assert.ok(parsed.failures[0].name.includes('should submit form successfully'));
  assert.ok(parsed.failures[0].details.some((d) => d.includes('AssertionError')));
  // Verify that passing checkmarks are NOT included in the failures list
  assert.ok(!parsed.failures[0].details.some((d) => d.includes('should render header')));
});

test('Verify: parseTestOutput handles all passing tests with zero failures', () => {
  const cleanTestOutput = `
✔ test 1 (1.0ms)
✔ test 2 (1.0ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
`;
  const parsed = parseTestOutput(cleanTestOutput, '', 0);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.passed, 2);
  assert.strictEqual(parsed.failed, 0);
  assert.strictEqual(parsed.failures.length, 0);
});

test('Verify: parseTestOutput accurately parses Vitest summary and isolates test count from audit rules', () => {
  const vitestOutput = `
 ✓ src/atoms/a-button/a-button.spec.ts (6)
 ✓ src/molecules/m-sample-card/m-sample-card.spec.ts (8)

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  08:00:00
   Duration  450ms

 AST Architecture: A+ (100/100, 44 rules evaluated)
`;
  const parsed = parseTestOutput(vitestOutput, '', 0);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.passed, 14);
  assert.strictEqual(parsed.totalTests, 14);
  assert.strictEqual(parsed.failed, 0);
});

test('Verify: parseTestOutput handles Vitest pipe separators with failures and skips', () => {
  const vitestMixedOutput = `
 ❯ src/trouble.spec.ts (3)
   ✖ broken test assertion

 Test Files  1 failed (1)
      Tests  1 failed | 1 skipped | 12 passed (14)
`;
  const parsed = parseTestOutput(vitestMixedOutput, '', 1);
  assert.strictEqual(parsed.success, false);
  assert.strictEqual(parsed.passed, 12);
  assert.strictEqual(parsed.failed, 1);
  assert.strictEqual(parsed.skipped, 1);
  assert.strictEqual(parsed.totalTests, 14);
});

test('Verify: runTypecheckAudit runs in JSON mode without throwing', async () => {
  const report = await runTypecheckAudit(['--json'], false, { print: false });
  assert.ok(typeof report.success === 'boolean');
  assert.ok(typeof report.errorCount === 'number');
  assert.ok(Array.isArray(report.errors));
});

test('Verify: runTypecheckAudit returns friendly message when node_modules is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-no-nm-tc-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    const report = await runTypecheckAudit(['--json'], false, { print: false, cwd: tmpDir });
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.exitCode, 1);
    assert.match(report.executionError, /Missing node_modules\. Please run '.* install' before typechecking\./);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Verify: runTestAudit returns friendly message when node_modules is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-no-nm-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    const report = await runTestAudit(['--json'], false, { print: false, cwd: tmpDir });
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.exitCode, 1);
    assert.match(report.executionError, /Missing node_modules\. Please run '.* install' before testing\./);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Verify: runProjectVerify returns friendly message when node_modules is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-no-nm-verify-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }));
    const summary = await runProjectVerify(['--json'], false, { print: false, cwd: tmpDir });
    assert.strictEqual(summary.success, false);
    assert.match(summary.error, /Missing node_modules\. Please run '.* install' before verifying\./);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Verify: runProjectVerify produces architecturalWarning when AST is clean but test/typecheck fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-arch-warn-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-arch-app',
      scripts: { test: 'node -e "process.exit(1)"' }
    }));
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src/sample.ts'), 'export const x = 1;\n');

    const summary = await runProjectVerify(['--json', `--dir=${path.join(tmpDir, 'src')}`], false, { print: false, cwd: tmpDir });
    assert.strictEqual(summary.success, false);
    assert.ok(summary.audit.grade === 'A+' || summary.audit.grade === 'A');
    assert.match(summary.architecturalWarning, /AST compliance does not guarantee functional correctness/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
