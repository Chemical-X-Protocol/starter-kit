import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTokenOptimized, generateAstOutline, generateAstLogicSkeleton, runReaderCli } from './reader.js';
import { handleChemxRead } from './mcp/tools-read.js';

const withProject = (files, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-read-truth-'));
  try {
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const VITE_CONFIG = [
  'export default {',
  '  // tests live next to sources',
  "  include: ['tests/**/*.spec.{js,ts}'],",
  "  cdn: '//cdn.example.com/a.js',",
  '  /* block */',
  '  url: `${base}//path`',
  '}',
  ''
].join('\n');

test('MCP read is verbatim by default: no comment stripping, no compaction, numbered lines', () => {
  withProject({ 'vite.config.js': VITE_CONFIG }, (dir) => {
    const out = handleChemxRead({ path: 'vite.config.js', startLine: 1, endLine: 7 }, dir);
    assert.ok(out.includes("3|  include: ['tests/**/*.spec.{js,ts}'],"), out);
    assert.ok(out.includes("4|  cdn: '//cdn.example.com/a.js',"), out);
    assert.ok(out.includes('2|  // tests live next to sources'), out);
    assert.ok(out.includes('6|  url: `${base}//path`'), out);
    assert.match(out.split('\n')[0], /vite\.config\.js:L1-7 of 7/);
  });
});

test('opt-in stripComments uses tokens: strings survive and line numbers stay true', () => {
  withProject({ 'vite.config.js': VITE_CONFIG }, (dir) => {
    const res = readTokenOptimized('vite.config.js', { cwd: dir, startLine: 1, endLine: 7, stripComments: true, compact: true });
    assert.ok(res.content.includes("cdn: '//cdn.example.com/a.js',"), res.content);
    assert.ok(res.content.includes('url: `${base}//path`'), res.content);
    assert.ok(!res.content.includes('tests live next'), res.content);
    const out = handleChemxRead({ path: 'vite.config.js', startLine: 1, endLine: 7, stripComments: true }, dir);
    assert.ok(out.includes("4|  cdn: '//cdn.example.com/a.js',"), out);
    assert.match(out, /comments stripped/);
  });
});

test('CLI symbol and range reads print N| numbers and a file:Lstart-end header', () => {
  withProject({ 'a.ts': 'const x = 1\n\nexport function go(n: number) {\n  return n\n}\n' }, (dir) => {
    const cwd = process.cwd();
    let printed = '';
    const write = process.stdout.write;
    process.chdir(dir);
    process.stdout.write = (chunk) => { printed += chunk; return true; };
    try {
      runReaderCli(['a.ts', '--symbol=go'], false);
    } finally {
      process.stdout.write = write;
      process.chdir(cwd);
    }
    assert.match(printed, /a\.ts:L3-5 of 5/);
    assert.match(printed, /3\|export function go\(n: number\) \{\n4\|  return n\n5\|\}/);
  });
});

test('code outline entries carry L<start>-<end>, including Vue script blocks', () => {
  const ts = generateAstOutline('const a = 1\nexport function b() {\n  return a\n}\n', 'x.ts');
  assert.match(ts, /L1-1 {2}const a/);
  assert.match(ts, /L2-4 {2}export function b/);
  const vue = generateAstOutline('<template>\n  <div />\n</template>\n<script setup lang="ts">\nconst open = ref(false)\n</script>\n', 'c.vue');
  assert.match(vue, /L5-5 {2}ref open/);
});

test('logic skeleton is labeled and keeps the original declaration forms and types', () => {
  const code = [
    'export async function loadAll(pct: number): Promise<void> {',
    '  if (!pct) return',
    '  await fetchAll(pct)',
    '}',
    'export const after = () => 42',
    'const $reset = () => 0',
    'const isCustomTip = ref(false);',
    ''
  ].join('\n');
  const skeleton = generateAstLogicSkeleton(code, 'store.ts');
  assert.match(skeleton.split("\n")[0], /not verbatim/);
  assert.ok(skeleton.includes('export async function loadAll(pct: number): Promise<void> {'), skeleton);
  assert.ok(!/const const|return export|return const/.test(skeleton), skeleton);
  assert.ok(skeleton.includes('export const after = () => 42'), skeleton);
  assert.ok(skeleton.includes('const isCustomTip = ref(false);'), skeleton);
});

test('enrich skips non-Babel files instead of dumping them', () => {
  withProject({ '_mixins.scss': '@mixin a { color: red; }\n'.repeat(5) }, (dir) => {
    const res = readTokenOptimized('_mixins.scss', { cwd: dir, outline: true, enrich: true });
    assert.ok(!(res.enriched || '').includes('@mixin a'), res.enriched);
  });
});

test('CLI --connections prints the connection card; a plain --symbol read creates no index', async () => {
  const { syncSearchIndex } = await import('./search.js');
  withProject({ 'a.ts': 'export const go = () => 1\n' }, (dir) => {
    const cwd = process.cwd();
    let printed = '';
    const write = process.stdout.write;
    process.chdir(dir);
    process.stdout.write = (chunk) => { printed += chunk; return true; };
    try {
      runReaderCli(['a.ts', '--symbol=go'], false);
      assert.equal(fs.existsSync(path.join(dir, '.chemx')), false, 'symbol read must not create .chemx');
      syncSearchIndex('.', dir);
      runReaderCli(['a.ts', '--connections'], false);
    } finally {
      process.stdout.write = write;
      process.chdir(cwd);
    }
    assert.match(printed, /File Connections: imports \d+ symbol\(s\)/);
  });
});

const captureStdout = (dir, fn) => {
  const cwd = process.cwd();
  let printed = '';
  const write = process.stdout.write;
  process.chdir(dir);
  process.stdout.write = (chunk) => { printed += chunk; return true; };
  try {
    fn();
  } finally {
    process.stdout.write = write;
    process.chdir(cwd);
  }
  return printed;
};

const CALL_GRAPH = {
  'calls.ts': 'export const leaf = () => 1\nexport const mid = () => leaf()\n',
  'use.ts': "import { mid } from './calls'\nexport const top = () => mid()\n"
};

test('CLI and MCP --backtrace print the root callers from the index', async () => {
  const { syncSearchIndex } = await import('./search.js');
  withProject(CALL_GRAPH, (dir) => {
    syncSearchIndex('.', dir);
    const printed = captureStdout(dir, () => runReaderCli(['calls.ts', '--backtrace=mid'], false));
    assert.match(printed, /--- Backtrace: mid \(\d+ caller\(s\)\) ---/);
    assert.match(printed, /<- use\.ts/);
    const mcp = handleChemxRead({ path: 'calls.ts', backtraceSymbol: 'mid' }, dir);
    assert.match(mcp, /<- use\.ts/);
  });
});

test('CLI and MCP --trace print a card even when nothing is called', async () => {
  const { syncSearchIndex } = await import('./search.js');
  withProject(CALL_GRAPH, (dir) => {
    syncSearchIndex('.', dir);
    const printed = captureStdout(dir, () => runReaderCli(['calls.ts', '--trace=leaf'], false));
    assert.match(printed, /--- Forward Trace: leaf ---/);
    const mcp = handleChemxRead({ path: 'use.ts', traceSymbol: 'top' }, dir);
    assert.match(mcp, /--- Forward Trace: top ---/);
  });
});

test('without an index, cards say so instead of reporting zero references, and no index is created', () => {
  withProject(CALL_GRAPH, (dir) => {
    const printed = captureStdout(dir, () => runReaderCli(['calls.ts', '--symbol=mid', '--connections', '--backtrace=mid', '--trace=mid'], false));
    assert.doesNotMatch(printed, /referenced by 0 file/);
    assert.match(printed, /Connections unavailable: no search index/);
    assert.match(printed, /Backtrace unavailable: no search index/);
    assert.match(printed, /Forward Trace unavailable: no search index/);
    assert.equal(fs.existsSync(path.join(dir, '.chemx')), false);
  });
});

test('line counts: a final newline ends the last line instead of adding an empty one', async () => {
  const { patchFile } = await import('./patcher.js');
  const nine = Array.from({ length: 9 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  withProject({ 'nine.js': nine, 'one.ts': 'export const x = 1\n' }, (dir) => {
    const out = handleChemxRead({ path: 'nine.js' }, dir);
    assert.match(out.split("\n")[0], /nine\.js:L1-9 of 9/);
    assert.doesNotMatch(out, /^\s*10\|/m);
    const range = handleChemxRead({ path: 'nine.js', startLine: 1 }, dir);
    assert.match(range.split('\n')[0], /L1-9 of 9/);
    const res = patchFile('one.ts', { targetContent: 'x = 1', replacementContent: 'x = 2', dryRun: true, cwd: dir, skipIndex: true });
    assert.equal(res.originalLines, 1);
    assert.equal(res.newLines, 1);
  });
});
