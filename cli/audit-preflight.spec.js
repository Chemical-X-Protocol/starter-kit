import test from 'node:test';
import assert from 'node:assert';
import { isSourceFilePath, parseGitStatusOutput } from './audit-preflight-git.js';
import { detectCandidateDirectories } from './audit-preflight-scope.js';
import { runAuditPreflight } from './audit-preflight.js';
import { scanTree, runAudit } from './audit.js';
import { auditCode } from './audit/rules.js';

test('isSourceFilePath: correctly validates source files and excludes tests', () => {
  assert.strictEqual(isSourceFilePath('src/app.tsx'), true);
  assert.strictEqual(isSourceFilePath('cli/index.js'), true);
  assert.strictEqual(isSourceFilePath('components/card.vue'), true);
  assert.strictEqual(isSourceFilePath('ui/button.svelte'), true);
  assert.strictEqual(isSourceFilePath('src/app.test.tsx'), false);
  assert.strictEqual(isSourceFilePath('src/app.spec.js'), false);
  assert.strictEqual(isSourceFilePath('dist/bundle.min.js'), false);
  assert.strictEqual(isSourceFilePath('types/index.d.ts'), false);
  assert.strictEqual(isSourceFilePath('README.md'), false);
});

test('parseGitStatusOutput: extracts clean file paths from git porcelain output', () => {
  const output = [
    ' M src/components/card.tsx',
    'A  cli/new-command.js',
    '?? scripts/scratch.ts',
    ' D old-file.js',
    '"quoted/path/with space.ts"'
  ].join('\n');

  const parsed = parseGitStatusOutput(output);
  assert.strictEqual(parsed.length, 5);
  assert.strictEqual(parsed[0], 'src/components/card.tsx');
  assert.strictEqual(parsed[1], 'cli/new-command.js');
  assert.strictEqual(parsed[2], 'scripts/scratch.ts');
  assert.strictEqual(parsed[3], 'old-file.js');
  assert.strictEqual(parsed[4], 'quoted/path/with space.ts');
});

test('detectCandidateDirectories: identifies existing directory targets', () => {
  const detected = detectCandidateDirectories(process.cwd());
  assert.ok(Array.isArray(detected));
  assert.ok(detected.includes('cli'));
});

test('runAuditPreflight: non-interactive mode resolves immediately without questions', async () => {
  const result = await runAuditPreflight(['--ci'], {
    defaultDir: 'cli',
    cwd: process.cwd()
  });

  assert.strictEqual(result.targetDir, 'cli');
  assert.strictEqual(result.fast, false);
  assert.strictEqual(result.fileList, null);
});

test('runAuditPreflight: explicit fast and customDir flags bypass questions', async () => {
  const result = await runAuditPreflight(['--fast', '--dir=cli'], {
    customDir: 'cli',
    defaultDir: 'src',
    cwd: process.cwd()
  });

  assert.strictEqual(result.targetDir, 'cli');
  assert.strictEqual(result.fast, true);
  assert.strictEqual(result.fileList, null);
});

test('runAuditPreflight: yes flag accepts defaults immediately', async () => {
  const result = await runAuditPreflight(['-y'], {
    defaultDir: 'cli',
    cwd: process.cwd()
  });

  assert.strictEqual(result.targetDir, 'cli');
  assert.strictEqual(result.fast, false);
  assert.strictEqual(result.fileList, null);
});

test('auditCode: fast mode executes line checks and bypasses AST parser', () => {
  const longFile = 'const a = 1;\n'.repeat(600);
  const violations = auditCode(longFile, 'src/monolith.ts', 'src/monolith.ts', { fast: true });

  assert.ok(violations.length > 0);
  const hasLineBudget = violations.some((v) => v.rule === 'LINE_BUDGET_FILE');
  assert.strictEqual(hasLineBudget, true);
});

test('scanTree: fileList restricts scanning strictly to specified files', () => {
  const result = scanTree('cli', process.cwd(), {
    fileList: ['cli/installer-templates.js']
  });

  assert.strictEqual(result.fileStats.length, 1);
  assert.strictEqual(result.fileStats[0].relativePath, 'cli/installer-templates.js');
});

test('runAudit: fast mode returns valid health metrics with zero AST traversal', () => {
  const report = runAudit('cli', { fast: true });

  assert.ok(report.scannedFiles > 0);
  assert.ok(report.health);
  assert.ok(typeof report.health.score === 'number');
  assert.ok(typeof report.health.grade === 'string');
});

test('runAuditPreflight: headless flag resolves immediately without interactive prompts', async () => {
  const result = await runAuditPreflight(['--headless'], {
    defaultDir: 'cli',
    cwd: process.cwd()
  });

  assert.strictEqual(result.targetDir, 'cli');
  assert.strictEqual(result.fast, false);
  assert.strictEqual(result.fileList, null);
});
