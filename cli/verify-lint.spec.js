import test from 'node:test';
import assert from 'node:assert';
import { detectLintCommand, parseLintOutput } from './verify-lint.js';

test('VerifyLint: detectLintCommand resolves custom command when provided', () => {
  const cmd = detectLintCommand('pnpm custom:lint');
  assert.strictEqual(cmd, 'pnpm custom:lint');
});

test('VerifyLint: detectLintCommand handles targetPath and --fix', () => {
  const cmd = detectLintCommand(null, process.cwd(), true, 'src/test.vue');
  assert.strictEqual(cmd, 'npx eslint --fix src/test.vue');

  const cmdNoFix = detectLintCommand(null, process.cwd(), false, 'src/test.vue');
  assert.strictEqual(cmdNoFix, 'npx eslint src/test.vue');
});

test('VerifyLint: detectLintCommand defaults to eslint or package script', () => {
  const cmd = detectLintCommand(null, process.cwd(), false, null);
  assert.ok(cmd.includes('eslint') || cmd.includes('lint'));
});

test('VerifyLint: parseLintOutput extracts errors, warnings, and fixable count', () => {
  const sampleOutput = `
/path/to/component.vue
  12:5   error    'unused' is defined but never used  no-unused-vars
  24:10  warning  Unexpected console statement        no-console

✖ 2 problems (1 error, 1 warning)
  1 error and 0 warnings potentially fixable with the \`--fix\` option.
`;

  const parsed = parseLintOutput(sampleOutput);
  assert.strictEqual(parsed.errorCount, 1);
  assert.strictEqual(parsed.warningCount, 1);
  assert.strictEqual(parsed.fixableCount, 1);
  assert.strictEqual(parsed.errors.length, 1);
  assert.strictEqual(parsed.warnings.length, 1);
  assert.strictEqual(parsed.errors[0].file, '/path/to/component.vue');
  assert.strictEqual(parsed.errors[0].line, 12);
  assert.strictEqual(parsed.errors[0].column, 5);
  assert.strictEqual(parsed.errors[0].ruleId, 'no-unused-vars');
  assert.strictEqual(parsed.warnings[0].ruleId, 'no-console');
});
