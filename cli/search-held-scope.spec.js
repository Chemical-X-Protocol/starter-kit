// Index answers that read more than the requested scope: graph modes, MCP envelopes, and the
// scope key the index records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clearDbCache } from './search-db.js';
import { withIndex } from './search-output.js';

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g6-held-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');
const runQ = (root, args) => {
  const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args, '--json'], { cwd: root, encoding: 'utf-8' });
  return { status: res.status, payload: JSON.parse(res.stdout.trim().split('\n').pop()) };
};

test('withIndex: a payload that says pass never hides an inconclusive index', () => {
  const merged = withIndex({ status: 'pass', count: 0 }, { status: 'inconclusive', reason: 'index busy' });
  assert.equal(merged.status, 'inconclusive');
});

test('MCP q graph modes report an inconclusive index (missing --dir), like the CLI', async () => {
  const root = makeProject({ 'src/a.js': 'export const useAlpha = () => 1;\n' });
  try {
    const { handleChemxQ } = await import('./mcp/tools-q.js');
    for (const mode of ['blastRadius', 'trace', 'backtrace', 'semantic']) {
      clearDbCache();
      const result = handleChemxQ({ query: 'useAlpha', dir: 'srcc', [mode]: true }, root);
      assert.equal(result.status, 'inconclusive', `${mode}: ${JSON.stringify(result).slice(0, 200)}`);
      assert.match(result.index.reason, /srcc/);
    }
  } finally {
    cleanup(root);
  }
});

const runText = (root, args) => spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd: root, encoding: 'utf-8' });

test('blast radius from the default scope finds a new consumer in a held scope', () => {
  const root = makeProject({
    'src/s.ts': 'export const useS = () => 1;\n',
    'lib/old.ts': "import { useS } from '../src/s';\nexport const oldUse = () => useS();\n"
  });
  try {
    runQ(root, ['useS', '--dir', '.']);
    fs.writeFileSync(path.join(root, 'lib/new.ts'), "import { useS } from '../src/s';\nexport const newUse = () => useS();\n");
    const blast = runQ(root, ['src/s.ts', '--blast-radius', '--raw-json']);
    const consumers = blast.payload.consumers.map((c) => c.path).sort();
    assert.deepEqual(consumers, ['lib/new.ts', 'lib/old.ts']);
    assert.equal(blast.payload.index.scope, '.');
    const text = runText(root, ['src/s.ts', '--blast-radius']);
    assert.match(text.stdout, /# index: scope \. \(requested src/);
  } finally {
    cleanup(root);
  }
});

test('def from the default scope finds a symbol in a new file of a held scope', () => {
  const root = makeProject({ 'src/a.ts': 'export const useA = () => 1;\n', 'other/o.ts': 'export const useO = () => 1;\n' });
  try {
    runQ(root, ['useO', '--dir', 'other']);
    fs.writeFileSync(path.join(root, 'other/n.ts'), 'export const useNewOther = () => 2;\n');
    const def = runQ(root, ['def', 'useNewOther']);
    assert.equal(def.status, 0, JSON.stringify(def.payload));
    assert.equal(def.payload.filePath, 'other/n.ts');
    assert.equal(def.payload.index.scope, 'other,src');
  } finally {
    cleanup(root);
  }
});

test('a held scope deleted from disk is dropped from the key, not reported missing', () => {
  const root = makeProject({ 'src/a.ts': 'export const useA = () => 1;\n', 'tmpx/t.ts': 'export const useT = () => 1;\n' });
  try {
    runQ(root, ['useT', '--dir', 'tmpx']);
    fs.rmSync(path.join(root, 'tmpx'), { recursive: true });
    const def = runQ(root, ['def', 'useA']);
    assert.equal(def.status, 0, JSON.stringify(def.payload));
    assert.equal(def.payload.index.scope, 'src');
  } finally {
    cleanup(root);
  }
});

test('an empty scope (no indexable files) is not recorded in the index scope key', () => {
  const root = makeProject({ 'src/a.ts': 'export const useA = () => 1;\n', 'docs/readme.md': '# docs\n' });
  try {
    runQ(root, ['useA']);
    const docs = runQ(root, ['useA', '--dir', 'docs']);
    assert.equal(docs.status, 3);
    const later = runQ(root, ['useA']);
    assert.equal(later.payload.index.indexedScopes, undefined, JSON.stringify(later.payload.index));
  } finally {
    cleanup(root);
  }
});

test('a sync commits its scope on top of the key as it is under the write lock (no lost update)', async () => {
  const root = makeProject({ 'a/x.js': 'export const xOne = 1;\n', 'b/y.js': 'export const yOne = 1;\n', 'c/z.js': 'export const zOne = 1;\n' });
  try {
    const { syncSearchIndex } = await import('./search-sync.js');
    const { commitSyncPlan } = await import('./search-sync-plan.js');
    const { readIndexMeta } = await import('./search-index-meta.js');
    const first = syncSearchIndex('a', root);
    // This plan was computed when the key was 'a', so b/y.js looked like an orphan.
    const stalePlan = { records: [], removable: [], orphans: ['b/y.js'], addDirs: ['c'], dropDirs: [] };
    syncSearchIndex('b', root);
    const committed = commitSyncPlan(first.db, stalePlan, 1);
    assert.equal(committed.scopeKey, 'a,b,c');
    assert.equal(readIndexMeta(first.db).scope, 'a,b,c');
    const kept = first.db.prepare("SELECT path FROM files WHERE path = 'b/y.js'").get();
    assert.ok(kept, 'rows of the concurrently merged scope are not pruned');
  } finally {
    cleanup(root);
  }
});

test('G6 sync modules stay under the 150-line module budget', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const file of ['search-sync.js', 'search-sync-rows.js', 'search-sync-plan.js']) {
    const lines = fs.readFileSync(path.join(here, file), 'utf-8').split('\n').length;
    assert.ok(lines < 150, `${file} has ${lines} lines`);
  }
});

test('def and trace of an unknown symbol are inconclusive (exit 3) with the index envelope', async () => {
  const root = makeProject({ 'src/a.ts': 'export const useA = () => 1;\n' });
  try {
    for (const args of [['def', 'useMissing'], ['useMissing', '--trace']]) {
      const res = runQ(root, args);
      assert.equal(res.status, 3, `${args.join(' ')}: ${JSON.stringify(res.payload)}`);
      assert.equal(res.payload.status, 'inconclusive');
      assert.equal(res.payload.index.scope, 'src');
    }
    const { handleChemxQ } = await import('./mcp/tools-q.js');
    clearDbCache();
    const mcp = handleChemxQ({ query: 'useMissing', trace: true }, root);
    assert.equal(mcp.status, 'inconclusive');
  } finally {
    cleanup(root);
  }
});

test('MCP read backtrace card lists root entry points (rootCallers are objects)', async () => {
  const root = makeProject({
    'src/s.ts': 'export const useS = () => 1;\n',
    'src/main.ts': "import { useS } from './s';\nuseS();\n"
  });
  try {
    runQ(root, ['useS']);
    clearDbCache();
    const { handleChemxRead } = await import('./mcp/tools-read.js');
    const out = handleChemxRead({ path: 'src/s.ts', enrich: true, backtraceSymbol: 'useS' }, root);
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    assert.match(text, /Backtrace: useS/);
    assert.match(text, /<- src\/main\.ts/);
  } finally {
    cleanup(root);
  }
});
