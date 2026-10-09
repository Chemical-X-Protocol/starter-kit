import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncSearchIndex } from './search-sync.js';
import { openIndexDb, clearDbCache, queryIndexPage } from './search-db.js';
import { describeIndexFromSync } from './search-output.js';

const makeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g6-scope-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

const indexedPaths = (root) => openIndexDb(root).prepare('SELECT path FROM files ORDER BY path').all().map((r) => r.path);

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

test('a wider sync never leaves ghost rows behind for a narrower scope', () => {
  const root = makeProject({ 'src/real.js': 'export const realOne = 1;\n', 'lib/ghost.js': 'export const ghostAlpha = 1;\n', 'lib/edit.js': 'export const beforeEdit = 1;\n' });
  try {
    syncSearchIndex('.', root);
    fs.rmSync(path.join(root, 'lib/ghost.js'));
    fs.writeFileSync(path.join(root, 'lib/edit.js'), 'export const afterEditLonger = 2;\n');
    const res = syncSearchIndex('src', root);
    assert.equal(res.status, 'fresh');
    assert.ok(!indexedPaths(root).includes('lib/ghost.js'), 'deleted file outside the requested scope is pruned');
    const db = openIndexDb(root);
    const edited = db.prepare("SELECT name FROM symbols WHERE file_path = 'lib/edit.js'").all().map((r) => r.name);
    assert.deepEqual(edited, ['afterEditLonger'], 'changed file outside the requested scope is re-parsed');
  } finally {
    cleanup(root);
  }
});

test('the default scope never serves rows that live outside it', () => {
  const root = makeProject({ 'src/real.js': 'export const realOne = 1;\n', 'lib/live.js': 'export const liveBeta = 1;\n' });
  try {
    syncSearchIndex('.', root);
    const res = syncSearchIndex('src', root);
    const db = openIndexDb(root);
    const page = queryIndexPage(db, { query: 'liveBeta', scopeDirs: res.scopeDirs });
    assert.equal(page.total, 0, 'lib/live.js is outside scope src');
    const listing = queryIndexPage(db, { query: '', scopeDirs: res.scopeDirs });
    assert.deepEqual(listing.results.map((r) => r.path), ['src/real.js']);
    const index = describeIndexFromSync(res);
    assert.equal(index.scope, 'src');
    assert.equal(index.files, 1, 'file count is the requested scope, not the whole db');
  } finally {
    cleanup(root);
  }
});

test('alternating scopes keep each other and do not rebuild', () => {
  const root = makeProject({ 'src/a.ts': 'export const useAlpha = 1;\n', 'other/b.ts': 'export const useBeta = 1;\n' });
  try {
    syncSearchIndex('src', root);
    syncSearchIndex('other', root);
    assert.deepEqual(indexedPaths(root), ['other/b.ts', 'src/a.ts']);
    const again = syncSearchIndex('src', root);
    assert.equal(again.updatedCount, 0, 'no rebuild when switching back');
    assert.equal(again.removedCount, 0);
  } finally {
    cleanup(root);
  }
});

test('a missing --dir is inconclusive and leaves the index intact', () => {
  const root = makeProject({ 'src/a.ts': 'export const useAlpha = 1;\n' });
  try {
    syncSearchIndex('src', root);
    const res = syncSearchIndex('srcc', root);
    assert.notEqual(res.status, 'fresh');
    assert.match(res.staleReason, /srcc/);
    assert.equal(describeIndexFromSync(res).status, 'inconclusive');
    assert.deepEqual(indexedPaths(root), ['src/a.ts'], 'the index is not wiped');
  } finally {
    cleanup(root);
  }
});

test('a scope with no indexable source files is inconclusive', () => {
  const root = makeProject({ 'src/a.ts': 'export const useAlpha = 1;\n', 'docs/readme.md': '# hi\n' });
  try {
    const res = syncSearchIndex('docs', root);
    const index = describeIndexFromSync(res);
    assert.equal(index.status, 'inconclusive');
    assert.match(index.reason, /no indexable/);
  } finally {
    cleanup(root);
  }
});

test('rows written without the current extractor version are re-parsed, not trusted by mtime', () => {
  const root = makeProject({ 'src/a.ts': 'export const useRealName = 1;\n' });
  try {
    syncSearchIndex('src', root);
    const db = openIndexDb(root);
    const row = db.prepare("SELECT mtime, size, tier, lines, chars FROM files WHERE path = 'src/a.ts'").get();
    db.exec("DELETE FROM symbols WHERE file_path = 'src/a.ts'; DELETE FROM files WHERE path = 'src/a.ts';");
    db.prepare('INSERT INTO files (path, mtime, size, tier, lines, chars) VALUES (?, ?, ?, ?, ?, ?)').run('src/a.ts', row.mtime, row.size, row.tier, row.lines, row.chars);
    db.prepare("INSERT INTO symbols (file_path, name, kind, is_export) VALUES ('src/a.ts', 'oldExtractorName', 'const', 1)").run();
    const res = syncSearchIndex('src', root);
    assert.equal(res.updatedCount, 1, 'an unversioned row (older chemx writer) is re-parsed');
    const names = db.prepare("SELECT name FROM symbols WHERE file_path = 'src/a.ts'").all().map((r) => r.name);
    assert.deepEqual(names, ['useRealName']);
  } finally {
    cleanup(root);
  }
});

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');
const runQ = (root, args) => {
  const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args, '--json'], { cwd: root, encoding: 'utf-8' });
  return { status: res.status, payload: JSON.parse(res.stdout.trim().split('\n').pop()) };
};

test('chemx q and MCP q never serve a file deleted after a wider sync', async () => {
  const root = makeProject({ 'src/real.js': 'export const realOne = 1;\n', 'lib/ghost.js': 'export const ghostAlpha = 1;\n' });
  try {
    const wide = runQ(root, ['ghostAlpha', '--dir', '.']);
    assert.equal(wide.payload.count, 1);
    fs.rmSync(path.join(root, 'lib/ghost.js'));
    const narrow = runQ(root, ['ghostAlpha']);
    assert.equal(narrow.payload.count, 0, JSON.stringify(narrow.payload.rows || narrow.payload.results));
    assert.equal(narrow.payload.index.scope, 'src');
    const { handleChemxQ } = await import('./mcp/tools-q.js');
    clearDbCache();
    const text = handleChemxQ({ query: 'ghostAlpha' }, root);
    assert.doesNotMatch(String(text), /lib\/ghost\.js/);
  } finally {
    cleanup(root);
  }
});

test('chemx q --dir with a mistyped dir is inconclusive (exit 3) and keeps the index', () => {
  const root = makeProject({ 'src/real.js': 'export const realOne = 1;\n' });
  try {
    runQ(root, ['realOne']);
    const typo = runQ(root, ['realOne', '--dir=srcc']);
    assert.equal(typo.status, 3);
    assert.equal(typo.payload.status, 'inconclusive');
    assert.match(typo.payload.index.reason, /srcc/);
    assert.equal(runQ(root, ['realOne']).payload.count, 1);
  } finally {
    cleanup(root);
  }
});

test('MCP q synchronizes newly created and edited files on demand', async () => {
  const root = makeProject({ 'src/initial.js': 'export const initialOne = 1;\n' });
  try {
    const { handleChemxQ } = await import('./mcp/tools-q.js');
    clearDbCache();
    const initialText = handleChemxQ({ query: 'initialOne' }, root);
    assert.match(String(initialText), /initial\.js/);

    fs.writeFileSync(path.join(root, 'src/useZebraFreshness.ts'), 'export function useZebraFreshness() { return 1; }\n');
    clearDbCache();
    const freshResult = handleChemxQ({ query: 'useZebraFreshness', columnar: true }, root);
    assert.equal(freshResult.total, 1);
    assert.equal(freshResult.rows[0][0], 'src/useZebraFreshness.ts');
  } finally {
    cleanup(root);
  }
});
