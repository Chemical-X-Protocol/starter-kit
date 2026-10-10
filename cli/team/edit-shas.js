// The sha1 chemx patch/write left on each file, kept in the coordination db (table edit_shas) so the
// out-of-band hook can tell a chemx edit from a foreign one (#4608).
// Guarantees: one row per absolute path (the latest chemx write), { path, sha1, handle, at }; a lookup
// returns that row or null. NOT guaranteed: a row exists only when the coordination db file already
// exists and is writable (it is never created here); a failed record is skipped silently, so a missing
// row means "unknown", not "foreign"; the row says what chemx last wrote, not that nothing wrote after.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { teamRootFor } from './coordination-target.js';
import { openExistingTeamDb, openTeamDbReadOnly, closeQuietly, safeGet } from './team-db-readonly.js';

const DDL = 'CREATE TABLE IF NOT EXISTS edit_shas (path TEXT PRIMARY KEY, sha1 TEXT NOT NULL, handle TEXT, at INTEGER NOT NULL)';

export const sha1OfText = (text) => crypto.createHash('sha1').update(text).digest('hex');

/** Records the sha1 of a file chemx just wrote. Returns true when a row was stored. */
export const recordEditSha = (absPath, { cwd = process.cwd(), handle = null, now = Date.now() } = {}) => {
  const root = teamRootFor(cwd);
  const db = root ? openExistingTeamDb(root) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  try {
    const sha1 = sha1OfText(fs.readFileSync(absPath));
    db.exec(DDL);
    db.prepare('INSERT OR REPLACE INTO edit_shas (path, sha1, handle, at) VALUES (?, ?, ?, ?)').run(absPath, sha1, handle, now);
    return true;
  } catch {
    return false;
  } finally {
    closeQuietly(db);
  }
};

/** The last recorded { path, sha1, handle, at } for absPath under the coordination db of root, or null. */
export const lookupEditSha = (absPath, root) => {
  const teamRoot = teamRootFor(root);
  const db = teamRoot ? openTeamDbReadOnly(teamRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  try {
    return safeGet(db, 'SELECT path, sha1, handle, at FROM edit_shas WHERE path = ?', [absPath]) ?? null;
  } finally {
    closeQuietly(db);
  }
};