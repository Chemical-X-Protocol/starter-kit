// Index truth (#2552): every index reader answers from rows that match the files on disk at the
// moment of the call, and says so in a freshness stamp. Files here are edited with plain
// fs.writeFileSync / renameSync / rmSync, never through chemx.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clearDbCache, openIndexDb } from './search-db.js';
import { ensureFresh } from './index-freshness.js';
import { handleChemxQ } from './mcp/tools-q.js';
import { buildReadCards } from './reader-cards.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const STAMP = /synced \d+ files, \d+ re-indexed, \d+ removed(, \d+ racy rows hash-checked)?, \d+ms/;
const CHILD_ENV = { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '' };

const makeProject = (files, { git = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-fresh-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  if (git) spawnSync('git', ['init', '-q', root], { stdio: 'ignore' });
  return root;
};

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

const write = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

const indexedPaths = (root) => openIndexDb(root).prepare('SELECT path FROM files ORDER BY path').all().map((r) => r.path);

const runQ = (root, args) => spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd: root, encoding: 'utf-8', env: CHILD_ENV });

const BASE = {
  'src/a.ts': 'export const useA = () => 1;\n',
  'src/b.ts': "import { useA } from './a';\nexport const useB = () => useA();\n"
};

test('q, read connections and blast radius see a file edited outside chemx', () => {
  const root = makeProject(BASE);
  try {
    ensureFresh(root);
    write(root, 'src/b.ts', 'export const useB = () => 2;\n');
    write(root, 'src/c.ts', "import { useA } from './a';\nexport const useC = () => useA();\n");
    assert.match(String(handleChemxQ({ query: 'useC' }, root)), /src\/c\.ts:2 definition useC/);
    const cards = buildReadCards(root, path.join(root, 'src/a.ts'), { connections: true });
    assert.match(cards.connection, /imported by 1 file\(s\)/, cards.connection);
    assert.match(cards.freshness, STAMP);
    const blast = handleChemxQ({ query: 'src/a.ts', blastRadius: true }, root);
    const pathColumn = blast.cols.indexOf('path');
    assert.deepEqual(blast.rows.map((row) => row[pathColumn]), ['src/c.ts']);
    assert.match(JSON.stringify(blast.index.freshness), /"checked":3/);
  } finally {
    cleanup(root);
  }
});

test('a read of one file syncs that file first, with one stat and no scope walk', () => {
  const root = makeProject(BASE);
  try {
    ensureFresh(root);
    write(root, 'src/a.ts', 'export const useAlphaRenamed = () => 1;\n');
    const session = ensureFresh(root, { paths: ['src/a.ts'], scope: false });
    assert.equal(session.freshness.checked, 1);
    assert.equal(session.freshness.reindexed, 1);
    const names = session.db.prepare("SELECT name FROM symbols WHERE file_path = 'src/a.ts'").all().map((r) => r.name);
    assert.deepEqual(names, ['useAlphaRenamed']);
  } finally {
    cleanup(root);
  }
});

const symbolsOf = (root, rel) => openIndexDb(root).prepare('SELECT name FROM symbols WHERE file_path = ?').all(rel).map((r) => r.name);

test('a same-size rewrite in the same clock tick (mtime unchanged) is caught by the content hash', () => {
  const root = makeProject({ 'src/r.ts': 'export const useR1 = () => 1;\n', 'src/s.ts': 'export const useS1 = () => 1;\n' });
  try {
    ensureFresh(root);
    // The race: a file written at T is synced at T, then rewritten (same size) inside the same tick.
    const rewriteInSameTick = (rel) => {
      const file = path.join(root, rel);
      const tick = new Date();
      fs.utimesSync(file, tick, tick);
      ensureFresh(root, { paths: [rel], scope: false });
      const before = fs.statSync(file);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('1', '2').replace('1', '2'));
      fs.utimesSync(file, tick, tick);
      assert.equal(fs.statSync(file).size, before.size);
      assert.equal(Math.floor(fs.statSync(file).mtimeMs), Math.floor(before.mtimeMs));
    };
    rewriteInSameTick('src/r.ts');
    const scoped = ensureFresh(root);
    assert.ok(scoped.freshness.hashed >= 1, JSON.stringify(scoped.freshness));
    assert.deepEqual(symbolsOf(root, 'src/r.ts'), ['useR2']);
    rewriteInSameTick('src/s.ts');
    const atHand = ensureFresh(root, { paths: ['src/s.ts'], scope: false });
    assert.deepEqual([atHand.freshness.hashed, atHand.freshness.reindexed], [1, 1]);
    assert.deepEqual(symbolsOf(root, 'src/s.ts'), ['useS2']);
  } finally {
    cleanup(root);
  }
});

test('a row whose file is clearly older than its sync is trusted on stat alone (no hashing)', () => {
  const root = makeProject(BASE);
  try {
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    for (const rel of Object.keys(BASE)) fs.utimesSync(path.join(root, rel), hourAgo, hourAgo);
    ensureFresh(root);
    const warm = ensureFresh(root);
    assert.equal(warm.freshness.hashed, 0);
    assert.equal(warm.freshness.reindexed, 0);
    assert.equal(warm.freshness.checked, 2);
  } finally {
    cleanup(root);
  }
});

test('deletes and renames on disk are reflected by the next answer', () => {
  const root = makeProject(BASE);
  try {
    ensureFresh(root);
    fs.renameSync(path.join(root, 'src/b.ts'), path.join(root, 'src/moved.ts'));
    fs.rmSync(path.join(root, 'src/a.ts'));
    const session = ensureFresh(root);
    assert.deepEqual(indexedPaths(root), ['src/moved.ts']);
    assert.equal(session.freshness.removed, 2);
    const fileAtHand = ensureFresh(root, { paths: ['src/moved.ts'], scope: false });
    fs.rmSync(path.join(root, 'src/moved.ts'));
    const gone = ensureFresh(root, { paths: ['src/moved.ts'], scope: false });
    assert.equal(fileAtHand.freshness.removed, 0);
    assert.equal(gone.freshness.removed, 1);
    assert.deepEqual(indexedPaths(root), []);
  } finally {
    cleanup(root);
  }
});

test('a git-ignored file is not indexed unless its dir is passed explicitly', () => {
  const root = makeProject({ ...BASE, '.gitignore': 'gen/\n', 'gen/g.ts': 'export const useGen = () => 1;\n' }, { git: true });
  try {
    ensureFresh(root);
    assert.ok(!indexedPaths(root).includes('gen/g.ts'), 'the project scope skips ignored files');
    const atHand = ensureFresh(root, { paths: ['gen/g.ts'], scope: false });
    assert.match(atHand.freshness.notIndexed[0].reason, /ignored by git/);
    assert.match(String(handleChemxQ({ query: 'useGen' }, root)), /No matching/);
    ensureFresh(root, { scope: 'gen' });
    assert.ok(indexedPaths(root).includes('gen/g.ts'), 'an explicit --dir opts in');
  } finally {
    cleanup(root);
  }
});

test('every index-backed answer carries the freshness stamp (CLI text, MCP text, JSON)', () => {
  const root = makeProject(BASE);
  try {
    const text = runQ(root, ['useA']);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, STAMP);
    const json = JSON.parse(runQ(root, ['useA', '--json', '--raw-json']).stdout.trim().split('\n').pop());
    assert.equal(typeof json.index.freshness.checked, 'number');
    assert.equal(typeof json.index.freshness.ms, 'number');
    clearDbCache();
    const mcp = String(handleChemxQ({ query: 'useA' }, root));
    assert.match(mcp.split('\n').pop(), STAMP, 'the MCP text answer ends with the stamp');
  } finally {
    cleanup(root);
  }
});

test('a read connection card for a git-ignored file says it is not indexed, never zero counts', () => {
  const root = makeProject({ ...BASE, '.gitignore': 'ignored.ts\n', 'ignored.ts': 'export const useIgnored = () => 1;\n' }, { git: true });
  try {
    ensureFresh(root);
    const cards = buildReadCards(root, path.join(root, 'ignored.ts'), { connections: true });
    assert.match(cards.connection, /Connections unavailable: ignored\.ts not indexed: ignored by git/);
    assert.doesNotMatch(cards.connection, /imports 0/);
  } finally {
    cleanup(root);
  }
});

test('a read-only db whose rows are still in the WAL is inconclusive (exit 3), not a crash', () => {
  const root = makeProject(BASE);
  try {
    assert.equal(runQ(root, ['useA']).status, 0);
    const dbFile = path.join(root, '.chemx', 'index.db');
    fs.chmodSync(dbFile, 0o444);
    fs.chmodSync(path.dirname(dbFile), 0o555);
    const res = runQ(root, ['useA']);
    assert.doesNotMatch(res.stderr + res.stdout, /no such table/);
    assert.ok(res.status === 0 || res.status === 3, `exit ${res.status}: ${res.stderr}`);
  } finally {
    fs.chmodSync(path.join(root, '.chemx'), 0o755);
    cleanup(root);
  }
});

test('a write lock already held when the db opens gives exit 3 with the busy reason, every time', () => {
  const root = makeProject(BASE);
  const dbFile = path.join(root, '.chemx', 'index.db');
  assert.equal(runQ(root, ['useA']).status, 0);
  const code = `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); console.log('held'); setTimeout(() => process.exit(0), 70000);`;
  const holder = spawn(process.execPath, ['--no-warnings', '-e', code, dbFile], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    holder.stdout.once('data', () => {
      try {
        write(root, 'src/a.ts', 'export const useA = () => 2;\n');
        const first = runQ(root, ['useA']);
        const second = runQ(root, ['useA', '--json']);
        for (const res of [first, second]) {
          assert.equal(res.status, 3, `exit ${res.status}: ${res.stderr}${res.stdout}`);
          assert.doesNotMatch(res.stderr, /no such table/);
        }
        assert.match(first.stdout + first.stderr, /busy/i);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        holder.kill();
        cleanup(root);
      }
    });
  });
});

const runQAsync = (root, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd: root, env: CHILD_ENV });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('close', (code) => resolve({ code, stderr }));
});

test('two concurrent cold syncs of the same db do not error and leave one row per file', async () => {
  const files = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`src/m${i}.ts`, `export const useM${i} = () => ${i};\n`]));
  const root = makeProject(files);
  try {
    const results = await Promise.all([runQAsync(root, ['useM1']), runQAsync(root, ['useM2'])]);
    for (const res of results) {
      assert.ok(res.code === 0 || res.code === 3, `exit ${res.code}: ${res.stderr}`);
      assert.doesNotMatch(res.stderr, /SQLITE|database is locked|UNIQUE/);
    }
    const db = openIndexDb(root);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 60);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM symbols WHERE name = 'useM7'").get().n, 1);
  } finally {
    cleanup(root);
  }
});
