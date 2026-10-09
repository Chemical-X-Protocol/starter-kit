import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('autofix: an explicit excluded or missing target is reported as skipped, not as clean', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-autofix-skip-')));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Title\n\n// hope this helps\n');
    const md = runAutofix('README.md', { cwd: dir, dryRun: true });
    assert.equal(md.skipped.length, 1);
    assert.equal(md.skipped[0].file, 'README.md');
    assert.match(md.skipped[0].reason, /\.md files are not autofix targets/);
    const missing = runAutofix('nope.ts', { cwd: dir, dryRun: true });
    assert.match(missing.skipped[0].reason, /does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const captureOut = async (fn) => {
  const out = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  try {
    const result = await fn();
    return { result, text };
  } finally {
    process.stdout.write = out;
  }
};

test('autofix CLI: nothing checked is inconclusive (exit 3); nothing changed never claims a mutation', async () => {
  const { runMutatorCli } = await import('../mutators.js');
  const { spawnSync } = await import('node:child_process');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-autofix-status-')));
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'docs', 'x.md'), MD_PROBE);
    fs.writeFileSync(path.join(dir, 'README.md'), MD_PROBE);
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    process.chdir(dir);
    const docs = await captureOut(() => runMutatorCli(['fix', 'docs'], false));
    assert.equal(docs.result.status, 'inconclusive');
    assert.doesNotMatch(docs.text, /Applied/);
    const clean = await captureOut(() => runMutatorCli(['fix', 'src'], false));
    assert.equal(clean.result.status, 'pass');
    assert.doesNotMatch(clean.text, /Applied/);
    assert.match(clean.text, /No changes written/);
    assert.match(clean.text, /0 of 1 file/);
    const cli = fileURLToPath(new URL('../index.js', import.meta.url));
    const run = spawnSync(process.execPath, [cli, 'fix', 'README.md', '--json'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(run.status, 3, run.stdout + run.stderr);
    assert.equal(JSON.parse(run.stdout.trim().split('\n').pop()).success, false);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
