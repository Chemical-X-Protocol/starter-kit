/**
 * Seeding a worktree's index from its parent checkout (#6769, K8b): rows are copied for the files whose
 * bytes hash to the parent's recorded content_hash, nothing else; board, stamp and audit rows never move.
 * The parent is injected here (a plain directory); the git layouts are in index-seed-e2e.spec.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { clearDbCache, openIndexDb, findSymbolDefinition } from './search-db.js';
import { syncSearchIndex } from './search-sync.js';
import { readIndexMeta } from './search-index-meta.js';
import { seedIndexFromParent, describeSeed, SEED_BUSY_TIMEOUT_MS } from './index-seed.js';

// An exported project root would pull every in-process reader off its temp project.
delete process.env.CHEMX_PROJECT_ROOT;

const FILES = {
  'src/h.js': 'export const helper = () => 1;\n',
  'src/a.js': "import { helper } from './h.js';\nexport const alpha = () => helper();\n",
  'src/b.js': 'export const beta = () => 2;\n',
  'src/c.js': 'export const gamma = () => 3;\n'
};

const makeRoot = (t, files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-seed-')));
  t.after(() => { clearDbCache(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"seed-spec"}\n');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};

// A parent with FILES indexed, and a "worktree" copy where b.js gained a symbol and c.js is gone.
const makePair = (t) => {
  const parent = makeRoot(t, FILES);
  syncSearchIndex('.', parent);
  const dbPath = path.join(parent, '.chemx', 'index.db');
  const worktree = makeRoot(t, { ...FILES, 'src/b.js': 'export const beta = () => 2;\nexport const betaTwo = () => 22;\n' });
  fs.rmSync(path.join(worktree, 'src', 'c.js'));
  const locate = () => ({ status: 'found', mainRoot: parent, dbPath });
  return { parent, dbPath, worktree, locate };
};

const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);

test('seed: rows of unchanged files are copied, changed and missing files are left to the sync', (t) => {
  const { parent, worktree, locate } = makePair(t);
  const parentDb = openIndexDb(parent);
  parentDb.exec("INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive) VALUES ('src/a.js', 'r', 'low', 'p', 1, 'h', 'd')");
  const db = openIndexDb(worktree);
  const before = Date.now();

  const seed = seedIndexFromParent(db, worktree, { locate });

  assert.equal(seed.status, 'seeded', seed.reason);
  assert.equal(seed.seeded, 2);
  assert.equal(seed.parentFiles, 4);
  assert.equal(seed.mainRoot, parent);
  assert.deepEqual(db.prepare('SELECT path FROM files ORDER BY path').all().map((r) => r.path), ['src/a.js', 'src/h.js']);
  const aRow = db.prepare('SELECT * FROM files WHERE path = ?').get('src/a.js');
  const aStat = fs.statSync(path.join(worktree, 'src', 'a.js'));
  assert.equal(Number(aRow.mtime), Math.floor(aStat.mtimeMs), 'mtime is the worktree file\'s, not the parent\'s');
  assert.equal(Number(aRow.size), aStat.size);
  assert.equal(aRow.content_hash, parentDb.prepare('SELECT content_hash FROM files WHERE path = ?').get('src/a.js').content_hash);
  assert.ok(Number(aRow.synced_at) >= before);
  assert.equal(findSymbolDefinition(db, 'alpha').filePath, 'src/a.js');
  assert.equal(findSymbolDefinition(db, 'beta'), null);
  assert.equal(count(db, 'imports'), 1, 'a.js imports helper');
  assert.equal(count(db, 'fts_index'), 2);
  assert.ok(count(db, 'embeddings') >= 2);
  assert.equal(readIndexMeta(db).scope, '.', 'the parent\'s scope key comes along');
  assert.equal(readIndexMeta(db).syncedAt, null, 'the parent\'s sync time does not');
  assert.equal(count(db, 'violations'), 0, 'audit rows stay with the parent');
  assert.equal(db.prepare('SELECT root_path FROM project_stamp').get().root_path, worktree);
  assert.equal(describeSeed(seed), `seeded 2 of 4 files from ${parent}`);
});

test('seed then sync: only the changed file is parsed, the new symbol is found, seeded rows survive', (t) => {
  const { worktree, locate } = makePair(t);
  const db = openIndexDb(worktree);
  seedIndexFromParent(db, worktree, { locate });

  const synced = syncSearchIndex('.', worktree);

  assert.equal(synced.status, 'fresh');
  assert.equal(synced.updatedCount, 1, 'b.js only');
  assert.equal(synced.removedCount, 0);
  assert.equal(synced.totalFiles, 3);
  assert.equal(synced.seed, null, 'nothing to seed once the index has rows');
  assert.equal(findSymbolDefinition(db, 'betaTwo').filePath, 'src/b.js');
  assert.equal(findSymbolDefinition(db, 'alpha').filePath, 'src/a.js');
  assert.equal(findSymbolDefinition(db, 'gamma'), null);
  assert.deepEqual(db.prepare('SELECT path FROM files ORDER BY path').all().map((r) => r.path), ['src/a.js', 'src/b.js', 'src/h.js']);
});

test('seed: an index that already has rows is left alone', (t) => {
  const { worktree, locate } = makePair(t);
  const db = openIndexDb(worktree);
  seedIndexFromParent(db, worktree, { locate });
  const again = seedIndexFromParent(db, worktree, { locate });
  assert.equal(again.status, 'none');
  assert.match(again.reason, /already has rows/);
  assert.equal(describeSeed(again), '');
});

test('seed: no parent index is none, and the sync indexes from disk', (t) => {
  const { worktree } = makePair(t);
  const db = openIndexDb(worktree);
  const none = seedIndexFromParent(db, worktree, { locate: () => ({ status: 'none', reason: 'not a linked worktree' }) });
  assert.equal(none.status, 'none');
  assert.equal(syncSearchIndex('.', worktree).updatedCount, 3);
});

test('seed: a parent index built by another extractor version is skipped with the versions named', (t) => {
  const { parent, worktree, locate } = makePair(t);
  openIndexDb(parent).exec("UPDATE index_meta SET value = '1' WHERE key = 'version'");
  const db = openIndexDb(worktree);
  const skipped = seedIndexFromParent(db, worktree, { locate });
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reason, /extractor v1.*this chemx is v2/);
  assert.equal(count(db, 'files'), 0);
  assert.equal(syncSearchIndex('.', worktree).updatedCount, 3);
  assert.match(describeSeed(skipped), /^seed from parent skipped: /);
});

test('seed: parent rows without content hashes match nothing and the seed is skipped', (t) => {
  const { parent, worktree, locate } = makePair(t);
  openIndexDb(parent).exec('UPDATE files SET content_hash = NULL');
  const db = openIndexDb(worktree);
  const skipped = seedIndexFromParent(db, worktree, { locate });
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reason, /none of the 4 files/);
  assert.equal(count(db, 'files'), 0);
  assert.equal(readIndexMeta(db).scope, null);
});

test('seed: a parent db another process holds exclusively is skipped as busy within the short timeout', (t) => {
  const { parent, dbPath, worktree, locate } = makePair(t);
  openIndexDb(parent).close();
  clearDbCache();
  const holder = new DatabaseSync(dbPath);
  holder.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN IMMEDIATE; UPDATE index_meta SET value = value WHERE key = 'version';");
  t.after(() => {
    try { holder.exec('COMMIT'); } catch { // chemx-allow: best-effort the test may already have committed and closed the holder
    }
    try { holder.close(); } catch { // chemx-allow: best-effort same
    }
  });
  const db = openIndexDb(worktree);

  const started = Date.now();
  const skipped = seedIndexFromParent(db, worktree, { locate });
  const elapsed = Date.now() - started;

  assert.equal(skipped.status, 'skipped', skipped.reason);
  assert.match(skipped.reason, /busy/);
  assert.ok(elapsed < SEED_BUSY_TIMEOUT_MS * 4, `waited ${elapsed}ms`);
  assert.equal(count(db, 'files'), 0);
  assert.equal(Number(db.prepare('PRAGMA busy_timeout').get().timeout), 5000, 'the worktree connection gets its busy timeout back');
  holder.exec('COMMIT');
  holder.close();
  assert.equal(seedIndexFromParent(db, worktree, { locate }).status, 'seeded', 'once released, the seed works');
});

test('seed: a parent db that is not a database is skipped, not thrown', (t) => {
  const { worktree } = makePair(t);
  const broken = path.join(worktree, 'broken.db');
  fs.writeFileSync(broken, 'not sqlite at all\n'.repeat(100));
  const db = openIndexDb(worktree);
  const skipped = seedIndexFromParent(db, worktree, { locate: () => ({ status: 'found', mainRoot: '/elsewhere', dbPath: broken }) });
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reason, /could not be read/);
  assert.equal(count(db, 'files'), 0);
});
