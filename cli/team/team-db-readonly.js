/**
 * Chemical X Protocol: read-only access to a project's team tables.
 * Briefs and profiles open .chemx/index.db read-only (the edit-locks.js readLeases pattern), so a
 * read never creates, migrates or cleans a database. Missing tables or columns read as empty.
 * Both openers refuse what coordination-root.js refuses (#2581): a db at the temp dir or the
 * filesystem root, and any db outside the temp dir from a spec process. A refused open is null.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { teamDbRefusal } from './coordination-root.js';

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[team-db-readonly] node:sqlite unavailable: ${err.message}\n`);
    return null;
  }
};
const DatabaseSync = await loadSqlite();

export const teamDbPath = (root) => path.join(root, '.chemx', 'index.db');

const mayOpen = (root, dbPath) => Boolean(DatabaseSync) && !teamDbRefusal(root) && fs.existsSync(dbPath);

/** @returns {import('node:sqlite').DatabaseSync | null} null when sqlite or the db file is missing, or the open is refused. */
export const openTeamDbReadOnly = (root) => {
  const dbPath = teamDbPath(root);
  const canOpen = mayOpen(root, dbPath);
  if (!canOpen) return null;
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[team-db-readonly] open skipped: ${err.message}\n`);
    return null;
  }
};

// Writable open of an EXISTING db only (never creates one); for cheap presence writes from hooks.
export const openExistingTeamDb = (root) => {
  const dbPath = teamDbPath(root);
  const canOpen = mayOpen(root, dbPath);
  if (!canOpen) return null;
  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 500');
    return db;
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[team-db-readonly] writable open skipped: ${err.message}\n`);
    return null;
  }
};

export const closeQuietly = (db) => {
  try {
    const isOpen = Boolean(db?.isOpen);
    if (isOpen) db.close();
  } catch {
    // chemx-allow: best-effort closing a finished handle cannot lose data
  }
};

/** Runs a read query; a missing table or column returns [] instead of throwing. */
export const safeAll = (db, sql, params = []) => {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
};

export const safeGet = (db, sql, params = []) => safeAll(db, sql, params)[0] ?? null;
