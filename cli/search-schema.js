import './silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { ensureChemxDir } from './audit/chemx-dir.js';
import { initTeamSchema } from './team/team-schema.js';
import { isSqliteMemoryTarget } from './sqlite-memory.js';
import { applyIndexSchema, registerVectorFunctions } from './search-schema-ddl.js';
import { ensureIndexVersion, readIndexMeta, isCurrentIndexVersion } from './search-index-meta.js';
import { debugNote } from './search-debug.js';
import { isSqliteBusyError } from './team/team-db-transaction.js';
import { guardProjectStamp } from './db-project-stamp.js';
import { withBusyRetry } from './team/coordination-busy.js';

let DatabaseSync = null;
try {
  const sqliteModule = await import('node:sqlite');
  DatabaseSync = sqliteModule.DatabaseSync;
} catch (err) {
  DatabaseSync = null;
  debugNote.warn('node:sqlite unavailable', err);
}

export const isSqliteAvailable = () => Boolean(DatabaseSync);

export const resolveIndexDbPath = (cwd = process.cwd()) => {
  const isMemoryTarget = isSqliteMemoryTarget(cwd);
  if (isMemoryTarget) return ':memory:';
  const dir = ensureChemxDir(cwd);
  return path.join(dir, 'index.db');
};

const DB_CACHE = new Map();
const DB_STATE = new WeakMap();

export const clearDbCache = () => {
  DB_CACHE.clear();
};

// Per-handle provenance: { isReadOnly, versionReset, isStaleVersion }.
export const getIndexDbState = (db) => DB_STATE.get(db) || { isReadOnly: false, versionReset: null, isStaleVersion: false, isBusyAtOpen: false };

export const warmIndexDb = (cwd = process.cwd()) => {
  return openIndexDb(cwd);
};

const applyConnectionPragmas = (db) => {
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (err) {
    // A concurrent writer can hold the lock while journal_mode switches; busy_timeout covers reads.
    debugNote.warn('connection pragmas', err);
  }
};

const initWritableDb = (db) => {
  applyIndexSchema(db);
  registerVectorFunctions(db);
  initTeamSchema(db);
  const versionReset = ensureIndexVersion(db);
  DB_STATE.set(db, { isReadOnly: false, versionReset: versionReset.reset ? versionReset : null, isStaleVersion: false });
  return db;
};

// ':memory:' is a database, never a directory: each call gets a fresh, fully initialised handle.
const openMemoryDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return initWritableDb(db);
};

const isPathWritable = (dbPath) => {
  try {
    fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
    const hasDbFile = fs.existsSync(dbPath);
    if (hasDbFile) fs.accessSync(dbPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// A handle counts only if it can read the schema: immutable=1 ignores the WAL, so rows still in an
// uncheckpointed WAL look like an empty file. The plain read-only open (which reads the WAL) goes first.
const openReadableAttempt = (open) => {
  let db = null;
  try {
    db = open();
    db.prepare('SELECT 1 FROM files LIMIT 1').get();
    return db;
  } catch (err) {
    debugNote.warn('read-only open', err);
    try { db?.close(); } catch (closeErr) { debugNote.warn('close after failed read-only open', closeErr); }
    return null;
  }
};

const openReadOnlyDb = (dbPath) => {
  const isExistingDb = fs.existsSync(dbPath);
  const attempts = isExistingDb
    ? [() => new DatabaseSync(dbPath, { readOnly: true }), () => new DatabaseSync(`file:${dbPath}?immutable=1`, { readOnly: true })]
    : [];
  for (const attempt of attempts) {
    const db = openReadableAttempt(attempt);
    if (db) return db;
  }
  try {
    const db = new DatabaseSync(':memory:');
    applyIndexSchema(db);
    return db;
  } catch (err) {
    debugNote.warn('in-memory fallback', err);
    return null;
  }
};

// Schema init takes a write lock; a concurrent writer can outlast busy_timeout under load.
// Retry busy errors instead of silently degrading to a read-only (stale) handle.
const openWritableDb = (dbPath, attempts = 4, outcome = {}) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath);
      applyConnectionPragmas(db);
      return initWritableDb(db);
    } catch (err) {
      try { db?.close(); } catch (closeErr) { debugNote.warn('close after failed open', closeErr); }
      const isBusy = isSqliteBusyError(err);
      const canRetry = isBusy && attempt < attempts;
      outcome.isBusy = isBusy;
      debugNote.warn(`writable open attempt ${attempt}`, err);
      if (!canRetry) return null;
    }
  }
  return null;
};

const openIndexDbUntimed = (cwd, options) => {
  if (!DatabaseSync) return null;
  const isMemoryTarget = isSqliteMemoryTarget(cwd);
  if (isMemoryTarget) return openMemoryDb();

  const dbPath = resolveIndexDbPath(cwd);
  const bypassCache = Boolean(options.fresh);
  const hasCachedDb = !bypassCache && DB_CACHE.has(dbPath);
  if (hasCachedDb) return DB_CACHE.get(dbPath);

  let db = null;
  const outcome = { isBusy: false };
  const canWrite = isPathWritable(dbPath);
  if (canWrite) db = openWritableDb(dbPath, 4, outcome);
  // A db copied in from another project is refused (closed, never cached) instead of serving its rows.
  if (db) guardProjectStamp(db, dbPath);

  if (!db) {
    const isExistingDb = fs.existsSync(dbPath);
    db = openReadOnlyDb(dbPath);
    if (!db) return null;
    registerVectorFunctions(db);
    const isStaleVersion = !isCurrentIndexVersion(readIndexMeta(db));
    DB_STATE.set(db, { isReadOnly: true, versionReset: null, isStaleVersion, isBusyAtOpen: outcome.isBusy });
    if (isExistingDb) guardProjectStamp(db, dbPath, { readOnly: true });
    // A handle opened only because another process held the write lock is never cached: the next call retries.
    if (outcome.isBusy) return db;
  }

  // Busy-retry and the env-gated slow-transaction log cover every writer of this db (#4520), not only team calls.
  withBusyRetry(db);
  DB_CACHE.set(dbPath, db);
  return db;
};

/**
 * Opens (or returns the cached) index db. With CHEMX_DB_SLOW_TX_MS set, an open slower than the
 * threshold is logged to stderr. The time includes busy-wait behind another writer and schema init,
 * so it measures this open, not who held the lock.
 */
export const openIndexDb = (cwd = process.cwd(), options = {}) => {
  const threshold = Number(process.env.CHEMX_DB_SLOW_TX_MS);
  const isWatched = Number.isFinite(threshold) && threshold > 0;
  if (!isWatched) return openIndexDbUntimed(cwd, options);
  const at = Date.now();
  const db = openIndexDbUntimed(cwd, options);
  const elapsed = Date.now() - at;
  const isSlow = elapsed > threshold;
  if (isSlow) process.stderr.write(`[chemx-db] openIndexDb elapsed ${elapsed} ms, including busy-wait and schema init (pid ${process.pid})\n`);
  return db;
};
