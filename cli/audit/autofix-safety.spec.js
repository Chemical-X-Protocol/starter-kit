import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autofixContent, runAutofix } from './autofix.js';

const TS_PROBE = "/* Here is the complete implementation of the parser.\n   Handles edge cases. */\nconst id = setTimeout(tick, 0);\nclearTimeout(id);\nconst label = 'Save — or cancel';\nconst prompt = `\n\\`\\`\\`ts\nfoo()\n\\`\\`\\`\n`;\n/*\n```ts\nexample()\n```\n*/\n";
const VUE_PROBE = "<template>\n  <!-- here's the updated component layout\n       header goes here -->\n  <h1>Title — Sub</h1>\n</template>\n";
const MD_PROBE = '# Usage\n\n```ts\nconst a = 1;\n```\n\nText — with dash\n';

test('autofix: removes a preamble comment only as a whole comment (no orphaned closer)', () => {
  const { fixedContent } = autofixContent(TS_PROBE, { filePath: 'probe.ts' });
  assert.ok(!fixedContent.includes('Handles edge cases. */'), fixedContent);
  assert.ok(fixedContent.startsWith('const id = setTimeout(tick, 0);'), fixedContent);
});

test('autofix: never touches string literals or template text', () => {
  const { fixedContent } = autofixContent(TS_PROBE, { filePath: 'probe.ts' });
  assert.ok(fixedContent.includes("const label = 'Save — or cancel';"), fixedContent);
  assert.ok(fixedContent.includes('const prompt = `\n\\`\\`\\`ts\nfoo()\n\\`\\`\\`\n`;'), fixedContent);
  assert.ok(fixedContent.includes('/*\n```ts\nexample()\n```\n*/'), 'fences inside a comment are content');
  const vue = autofixContent(VUE_PROBE, { filePath: 'c.vue' });
  assert.equal(vue.fixedContent, VUE_PROBE);
});

test('autofix: setTimeout(fn, 0) is a suggestion only', () => {
  const { fixedContent, fixes, suggestions } = autofixContent(TS_PROBE, { filePath: 'probe.ts' });
  assert.ok(fixedContent.includes('const id = setTimeout(tick, 0);'));
  assert.ok(!fixes.some((f) => f.rule === 'MACRO_TASK_OVER_MICRO_TASK'));
  assert.deepEqual(suggestions.map((s) => [s.rule, s.line]), [['MACRO_TASK_OVER_MICRO_TASK', 3]]);
});

test('autofix: Markdown is never fixed, and runAutofix does not collect .md files', () => {
  assert.equal(autofixContent(MD_PROBE, { filePath: 'README.md' }).fixedContent, MD_PROBE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-autofix-md-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), MD_PROBE);
    const res = runAutofix('.', { cwd: dir });
    assert.equal(res.filesScanned, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8'), MD_PROBE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('autofix: dry run lists every fix (uncapped) with a diff, and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-autofix-cap-'));
  try {
    const content = Array.from({ length: 30 }, (_, i) => `// note ${i} — detail\nexport const v${i} = ${i};`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'many.ts'), content);
    const res = runAutofix('many.ts', { cwd: dir, dryRun: true });
    assert.equal(res.totalFixes, 30);
    assert.equal(res.fixes.length, 30);
    assert.equal(res.omittedFixesCount, undefined);
    assert.match(res.diff, /^--- a\/many\.ts/);
    assert.equal(fs.readFileSync(path.join(dir, 'many.ts'), 'utf-8'), content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('autofix: a file that does not parse is skipped untouched, except edge fences that repair it', () => {
  const broken = 'const a = (1;\n// hope this helps\n';
  const res = autofixContent(broken, { filePath: 'x.ts' });
  assert.equal(res.fixedContent, broken);
  assert.match(res.skipped, /does not parse/);
  const fenced = autofixContent('```ts\nexport const a = 1;\n```\n', { filePath: 'x.ts' });
  assert.equal(fenced.fixedContent, 'export const a = 1;\n');
  assert.equal(fenced.fixes.length, 2);
});
