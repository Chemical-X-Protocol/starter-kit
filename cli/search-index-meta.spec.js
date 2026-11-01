import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openIndexDb, resolveIndexDbPath, getIndexDbState, clearDbCache } from './search-schema.js';
import { findChemxDir, ensureChemxDir } from './audit/history.js';
import { INDEX_VERSION, readIndexMeta, ensureIndexVersion, writeIndexMeta, describeVersionReset } from './search-index-meta.js';

const makeTmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `chemx-g6-${label}-`));

test(':memory: is a database, never a directory', () => {
  const tmp = makeTmp('mem');
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    assert.equal(resolveIndexDbPath(':memory:'), ':memory:');
    const first = openIndexDb(':memory:');
    const second = openIndexDb(':memory:');
    assert.ok(first, 'in-memory index opens');
    assert.notEqual(first, second, 'each :memory: open is an isolated database');
    const fileCount = first.prepare('SELECT COUNT(*) AS c FROM files').get().c;
    assert.equal(Number(fileCount), 0);
    assert.throws(() => ensureChemxDir(':memory:'), /in-memory/);
    assert.equal(fs.existsSync(path.join(tmp, ':memory:')), false, 'no literal :memory: directory is created');
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findChemxDir stops at a linked git worktree instead of sharing the main checkout index', () => {
  const tmp = makeTmp('wt');
  try {
    fs.mkdirSync(path.join(tmp, '.chemx'));
    const worktree = path.join(tmp, '.claude', 'worktrees', 'g6');
    fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${tmp}/.git/worktrees/g6\n`);
    const previousRoot = process.env.CHEMX_PROJECT_ROOT;
    delete process.env.CHEMX_PROJECT_ROOT;
    try {
      assert.equal(findChemxDir(path.join(worktree, 'src')), path.join(worktree, '.chemx'));
    } finally {
      if (previousRoot !== undefined) process.env.CHEMX_PROJECT_ROOT = previousRoot;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('index rows from an unversioned (older) extractor are wiped, audit data is kept', () => {
  const tmp = makeTmp('ver');
  try {
    fs.mkdirSync(path.join(tmp, '.chemx'));
    const dbPath = path.join(tmp, '.chemx', 'index.db');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tier TEXT NOT NULL, lines INTEGER NOT NULL, chars INTEGER NOT NULL);
      CREATE TABLE audit_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, score INTEGER NOT NULL, grade TEXT NOT NULL, asi INTEGER NOT NULL, total_loc INTEGER NOT NULL, scanned_files INTEGER NOT NULL, critical_count INTEGER NOT NULL, high_med_count INTEGER NOT NULL, low_count INTEGER NOT NULL);
      INSERT INTO files VALUES ('src/old.ts', 1, 1, 'utility', 1, 1);
      INSERT INTO audit_snapshots (timestamp, score, grade, asi, total_loc, scanned_files, critical_count, high_med_count, low_count) VALUES (1, 90, 'A', 90, 10, 1, 0, 0, 0);
    `);
    legacy.close();

    clearDbCache();
    const db = openIndexDb(tmp, { fresh: true });
    const state = getIndexDbState(db);
    assert.ok(state.versionReset, 'a version reset is reported');
    assert.equal(state.versionReset.droppedFiles, 1);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM files').get().c), 0, 'stale rows are not served');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM audit_snapshots').get().c), 1, 'audit history survives');
    assert.equal(readIndexMeta(db).version, INDEX_VERSION);
    db.close();
    clearDbCache();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const makeVersionedDb = (version) => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tier TEXT NOT NULL, lines INTEGER NOT NULL, chars INTEGER NOT NULL);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY);
    CREATE TABLE props (id INTEGER PRIMARY KEY);
    CREATE TABLE hooks (id INTEGER PRIMARY KEY);
    CREATE TABLE imports (id INTEGER PRIMARY KEY);
    CREATE TABLE embeddings (id INTEGER PRIMARY KEY);
    CREATE TABLE fts_index (id INTEGER PRIMARY KEY);
    INSERT INTO files VALUES ('src/a.ts', 1, 1, 'utility', 1, 1);
  `);
  writeIndexMeta(db, { version });
  return db;
};

test('a lower stored version is wiped and restamped', () => {
  const db = makeVersionedDb(INDEX_VERSION - 1);
  const result = ensureIndexVersion(db);
  assert.equal(result.reset, true);
  assert.equal(result.foreign, undefined);
  assert.equal(result.droppedFiles, 1);
  assert.equal(readIndexMeta(db).version, INDEX_VERSION);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM files').get().c), 0);
  db.close();
});

test('a higher stored version is foreign: rows and stamp are left alone', () => {
  const higher = INDEX_VERSION + 1;
  const db = makeVersionedDb(higher);
  const result = ensureIndexVersion(db);
  assert.equal(result.reset, false);
  assert.equal(result.foreign, true);
  assert.equal(result.previousVersion, higher);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM files').get().c), 1, 'newer rows survive');
  assert.equal(readIndexMeta(db).version, higher, 'stamp is not downgraded');
  assert.match(describeVersionReset(result), /newer chemx/);
  db.close();
});
