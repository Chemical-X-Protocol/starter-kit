import test from 'node:test';
import assert from 'node:assert';
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

test('Verify: runTypecheckAudit runs in JSON mode without throwing', async () => {
  const report = await runTypecheckAudit(['--json'], false, { print: false });
  assert.ok(typeof report.success === 'boolean');
  assert.ok(typeof report.errorCount === 'number');
  assert.ok(Array.isArray(report.errors));
});
