import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { autofixContent, runAutofix } from './autofix.js';

test('autofixContent: replaces em dash with standard hyphen', () => {
  const input = 'const title = "Welcome — User Dashboard";\n// Notes — see section 3';
  const { fixedContent, fixes } = autofixContent(input);

  assert.equal(fixes.length, 2);
  assert.equal(fixes[0].rule, 'TYPOGRAPHY_EM_DASH');
  assert.equal(fixedContent, 'const title = "Welcome - User Dashboard";\n// Notes - see section 3');
});

test('autofixContent: removes leaked markdown code fences', () => {
  const input = '```typescript\nimport { ref } from "vue";\n```';
  const { fixedContent, fixes } = autofixContent(input);

  assert.equal(fixes.length, 2);
  assert.equal(fixes[0].rule, 'AI_SLOP_CONVERSATIONAL_ARTIFACT');
  assert.equal(fixes[1].rule, 'AI_SLOP_CONVERSATIONAL_ARTIFACT');
  assert.equal(fixedContent, 'import { ref } from "vue";');
});

test('autofixContent: removes conversational residue comments and preambles', () => {
  const input = [
    '// Here is the complete code:',
    'export const add = (a, b) => a + b;',
    '// Hope this helps! Feel free to tweak as needed.'
  ].join('\n');

  const { fixedContent, fixes } = autofixContent(input);
  assert.equal(fixes.length, 2);
  assert.equal(fixes[0].rule, 'AI_SLOP_CONVERSATIONAL_ARTIFACT');
  assert.equal(fixes[1].rule, 'AI_SLOP_CONVERSATIONAL_ARTIFACT');
  assert.equal(fixedContent, 'export const add = (a, b) => a + b;');
});

test('autofixContent: removes lazy truncation comments', () => {
  const input = [
    'export const config = {',
    '  // ... existing code',
    '  timeout: 5000',
    '};'
  ].join('\n');

  const { fixedContent, fixes } = autofixContent(input);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].rule, 'AI_SLOP_LAZY_PLACEHOLDER');
  assert.equal(fixedContent, 'export const config = {\n  timeout: 5000\n};');
});

test('autofixContent: respects rule filtering', () => {
  const input = '```\nconst x = "foo — bar";';
  const { fixedContent, fixes } = autofixContent(input, { rules: ['TYPOGRAPHY_EM_DASH'] });

  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].rule, 'TYPOGRAPHY_EM_DASH');
  assert.ok(fixedContent.includes('```'));
  assert.ok(fixedContent.includes('foo - bar'));
});

test('runAutofix: handles dryRun and file write correctly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-autofix-test-'));
  const testFile = path.join(tempDir, 'test.ts');
  fs.writeFileSync(testFile, 'const msg = "test — em dash";\n// hope this helps', 'utf-8');

  // Dry run: reports fixes without modifying file
  const dryResult = runAutofix(testFile, { dryRun: true, cwd: tempDir });
  assert.equal(dryResult.filesChanged, 1);
  assert.equal(dryResult.totalFixes, 2);
  assert.equal(dryResult.dryRun, true);
  assert.equal(fs.readFileSync(testFile, 'utf-8'), 'const msg = "test — em dash";\n// hope this helps');

  // Live run: writes changes
  const liveResult = runAutofix(testFile, { dryRun: false, cwd: tempDir });
  assert.equal(liveResult.filesChanged, 1);
  assert.equal(liveResult.totalFixes, 2);
  assert.equal(liveResult.dryRun, false);
  assert.equal(fs.readFileSync(testFile, 'utf-8'), 'const msg = "test - em dash";');

  fs.rmSync(tempDir, { recursive: true, force: true });
});
