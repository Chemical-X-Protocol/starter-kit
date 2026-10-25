import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLintCommand, parseLintOutput, runLintAudit } from './verify-lint.js';
import { relativeLintTargets } from './lint-scope.js';
import { stripAnsi } from './terminal.js';

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

test('verify-helpers: parseCommandFromArgs re-quotes the words after --, like every other command', async () => {
  const { parseCommandFromArgs } = await import('./verify-helpers.js');
  assert.equal(parseCommandFromArgs(['--json', '--', 'eslint', '--rule', 'no-console: off']), 'eslint --rule "no-console: off"');
  assert.equal(parseCommandFromArgs(['--', 'npm run lint']), 'npm run lint');
  assert.equal(parseCommandFromArgs(['--']), null);
  assert.equal(parseCommandFromArgs(['--json']), null);
});

test('VerifyLint: detectLintCommand passes several paths to ESLint and quotes a path with a space', () => {
  assert.strictEqual(detectLintCommand(null, process.cwd(), false, ['a.js', 'b dir/c.js']), 'npx eslint a.js "b dir/c.js"');
  assert.strictEqual(detectLintCommand(null, process.cwd(), true, ['a.js']), 'npx eslint --fix a.js');
});

test('VerifyLint: relativeLintTargets re-roots the paths the caller typed at the directory ESLint runs in', () => {
  const root = path.resolve('/r');
  assert.deepStrictEqual(relativeLintTargets(['a.js', '../x.js', 'sub'], path.join(root, 'src'), root), ['src/a.js', 'x.js', 'src/sub']);
  assert.deepStrictEqual(relativeLintTargets(['a.js'], root, root), ['a.js']);
});

const DISPATCH_SWITCH = "export const pick = (kind) => {\n  switch (kind) {\n    case 'a': return 1;\n    case 'b': return 2;\n    case 'c': return 3;\n    default: return 0;\n  }\n};\n";
const CLEAN = 'export const one = 1;\n';
const ESLINT_6_BANNER = "console.error(\"Oops! Something went wrong! :(\\n\\nESLint: 6.4.0.\\n\\nESLint couldn't find a configuration file. To set up a configuration file for this project, please run:\\n\\n    eslint --init\\n\");\nprocess.exit(2);\n";

const withTree = async (files, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lint-run-')));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const printed = async (run) => {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    const report = await run();
    return { report, out: stripAnsi(out) };
  } finally {
    process.stdout.write = original;
  }
};

const PACKAGE = JSON.stringify({ name: 'fixture', private: true });
const quiet = (cwd, extra = {}) => ({ cwd, print: false, ...extra });

test('VerifyLint: a project with no ESLint config says so in one line and runs check on the named files', async () => {
  await withTree({ 'package.json': PACKAGE, 'bad.js': DISPATCH_SWITCH, 'ok.js': CLEAN }, async (root) => {
    const report = await runLintAudit(['bad.js', 'ok.js', '--json'], false, quiet(root));
    assert.strictEqual(report.note, `no ESLint config in ${root}; ran chemx check on 2 files instead`);
    assert.strictEqual(report.fallback, 'NO_ESLINT_CONFIG');
    assert.strictEqual(report.command, 'chemx check');
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.exitCode, 1);
    assert.strictEqual(report.hazards.length, 1);
    assert.strictEqual(report.hazards[0].ruleId, 'CONTROL_FLOW_DISPATCH_SWITCH');
    assert.strictEqual(report.micro.checked, 2);
  });
});

test('VerifyLint: the fallback prints the note, then check\'s own hazard text, and a clean run passes', async () => {
  await withTree({ 'package.json': PACKAGE, 'bad.js': DISPATCH_SWITCH, 'ok.js': CLEAN }, async (root) => {
    const dirty = await printed(() => runLintAudit(['bad.js'], false, { cwd: root }));
    const lines = dirty.out.split('\n').filter(Boolean);
    assert.strictEqual(lines[0].trim(), `no ESLint config in ${root}; ran chemx check on 1 file instead`);
    assert.match(dirty.out, /Chemical X Micro-Check: bad\.js[\s\S]*\[MEDIUM\] Line 2: CONTROL_FLOW_DISPATCH_SWITCH/);
    const clean = await printed(() => runLintAudit(['ok.js'], false, { cwd: root }));
    assert.match(clean.out, /✔ Crystalline: ok\.js \(0 hazards, \d+ms\)/);
    assert.strictEqual(clean.report.success, true);
    assert.strictEqual(clean.report.exitCode, 0);
  });
});

test('VerifyLint: a plugin directory with no package.json lints itself, not the monorepo above it', async () => {
  const files = {
    'package.json': PACKAGE, 'eslint.config.js': 'export default [];\n', 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n", 'apps/web/package.json': PACKAGE,
    'wp-content/plugins/card/includes/a.js': CLEAN
  };
  await withTree(files, async (root) => {
    const plugin = path.join(root, 'wp-content', 'plugins', 'card');
    const single = await runLintAudit(['includes/a.js', '--json'], false, quiet(plugin));
    assert.strictEqual(single.note, `no ESLint config in ${plugin} (no package.json); ran chemx check on 1 file instead`);
    assert.strictEqual(single.fallback, 'NO_PACKAGE_JSON');
    assert.strictEqual(single.success, true);
    const bare = await runLintAudit(['--json'], false, quiet(plugin));
    assert.notStrictEqual(bare.reason, 'MONOREPO_ROOT');
    assert.strictEqual(bare.micro.checked, 1);
  });
});

test('VerifyLint: lint <paths> in a configured project adds the micro-check hazards to the ESLint result', async () => {
  const files = { 'package.json': PACKAGE, 'node_modules/.keep': '', 'eslint.config.js': 'export default [];\n', 'bad.js': DISPATCH_SWITCH, 'ok.js': CLEAN };
  await withTree(files, async (root) => {
    const dirty = await runLintAudit(['bad.js', '--json'], false, quiet(root, { command: 'node -e 0' }));
    assert.strictEqual(dirty.fallback, undefined);
    assert.strictEqual(dirty.errorCount, 0);
    assert.strictEqual(dirty.success, false);
    assert.strictEqual(dirty.hazards[0].file, 'bad.js');
    const clean = await runLintAudit(['ok.js', '--json'], false, quiet(root, { command: 'node -e 0' }));
    assert.strictEqual(clean.success, true);
    assert.strictEqual(clean.hazards.length, 0);
    const bare = await runLintAudit(['--json'], false, quiet(root, { command: 'node -e 0' }));
    assert.strictEqual(bare.micro, undefined, 'no paths, no micro-checks: the audit covers a whole project');
  });
});

test('VerifyLint: a fatal ESLint run shows the underlying error, not the Oops banner', async () => {
  await withTree({ 'package.json': PACKAGE, 'node_modules/.keep': '', 'eslint.config.js': '', 'fake-eslint.js': ESLINT_6_BANNER, 'legacy/package.json': PACKAGE, 'legacy/node_modules/.keep': '', 'legacy/.eslintrc.json': '{}', 'legacy/fake-eslint.js': ESLINT_6_BANNER }, async (root) => {
    const flat = await runLintAudit(['--json'], false, quiet(root, { command: 'node fake-eslint.js' }));
    assert.match(flat.executionError, /eslint\.config\.js needs ESLint 9 or newer.*resolved ESLint 6\.4\.0/);
    const legacy = await runLintAudit(['--json'], false, quiet(path.join(root, 'legacy'), { command: 'node fake-eslint.js' }));
    assert.strictEqual(legacy.executionError, "ESLint couldn't find a configuration file.");
  });
});

test('VerifyLint: a named file chemx does not audit is reported as skipped, not silently dropped', async () => {
  await withTree({ 'package.json': PACKAGE, 'notes.md': '# n\n', 'ok.js': CLEAN }, async (root) => {
    const report = await runLintAudit(['notes.md', 'ok.js', '--json'], false, quiet(root));
    assert.deepStrictEqual(report.skipped, ['notes.md']);
    assert.strictEqual(report.micro.checked, 1);
    assert.strictEqual(report.success, true);
    const text = await printed(() => runLintAudit(['notes.md'], false, { cwd: root }));
    assert.match(text.out, /ran chemx check on 0 files instead\n\s+skipped \(not a source file chemx audits\): notes\.md/);
  });
});

test('VerifyLint: a typed path that does not exist fails the run and is named', async () => {
  await withTree({ 'package.json': PACKAGE, 'ok.js': CLEAN }, async (root) => {
    const report = await runLintAudit(['nope.js', 'ok.js', '--json'], false, quiet(root));
    assert.deepStrictEqual(report.missing, ['nope.js']);
    assert.strictEqual(report.success, false);
    const text = await printed(() => runLintAudit(['nope.js'], false, { cwd: root }));
    assert.match(text.out, /✕ File not found: nope\.js/);
  });
});
