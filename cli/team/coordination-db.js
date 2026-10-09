/**
 * Chemical X Protocol: the one opener for team tables (#2488).
 * Every team entry point (CLI from any cwd, MCP with any projectRoot) opens its db here; which db
 * that is comes from coordination-target.js (read-only, also used by hooks). CHEMX_PROJECT_ROOT
 * never decides it: a db the code-index opener would not resolve to gets its own handle.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb } from '../search-db.js';
import { findChemxDir } from '../audit/chemx-dir.js';
import { guardProjectStamp } from '../db-project-stamp.js';
import { initTeamSchema } from './team-schema.js';
import { isSpecProcess } from './coordination-root.js';
import { closeQuietly } from './team-db-readonly.js';
import { resolveTeamDbTarget, teamDbPathFor, mergedSourceDbs, isUnmergedSilo } from './coordination-target.js';

export { resolveTeamDbTarget, teamDbPathFor, mergedSourceDbs, isUnmergedSilo, isSpecProcess };

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
};
const DatabaseSync = await loadSqlite();

const OWN_HANDLES = new Map();

const applyPragmas = (db) => {
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // chemx-allow: best-effort a concurrent writer can hold the lock while journal_mode switches; busy_timeout covers it
  }
};

// A db the code-index opener does not resolve to (CHEMX_PROJECT_ROOT elsewhere, or a root its walk
// skips) gets its own cached handle with the team schema only.
const openOwnHandle = (dbPath) => {
  const cached = OWN_HANDLES.get(dbPath);
  if (cached?.isOpen) return cached;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  applyPragmas(db);
  initTeamSchema(db);
  guardProjectStamp(db, dbPath);
  OWN_HANDLES.set(dbPath, db);
  return db;
};

const sharesIndexHandle = (root) => path.resolve(findChemxDir(root)) === path.join(root, '.chemx');

const openAtRoot = (root) => {
  const isAvailable = Boolean(DatabaseSync);
  if (!isAvailable) return null;
  const isShared = sharesIndexHandle(root);
  return isShared ? openIndexDb(root) : openOwnHandle(teamDbPathFor(root));
};

/**
 * Opens the team db for startDir. Returns { db, root, coordinationRoot, mode, repo, dbPath, refused };
 * db is null when sqlite is unavailable or the call was refused (a spec process outside the temp dir).
 */
export const openTeamContext = (startDir = process.cwd(), options = {}) => {
  const target = resolveTeamDbTarget(startDir, options);
  const db = target.refused ? null : openAtRoot(target.root);
  return { ...target, db };
};

/** The team db handle for startDir, or null (see openTeamContext). */
export const openTeamDb = (startDir = process.cwd(), options = {}) => openTeamContext(startDir, options).db;

/** Human text for a null handle: the spec refusal when there is one. */
export const describeTeamDbFailure = (context) => context?.refused || 'SQLite database unavailable.';

/** Closes handles this module opened itself (specs and long-lived servers that reset state). */
export const closeOwnTeamHandles = () => {
  for (const db of OWN_HANDLES.values()) closeQuietly(db);
  OWN_HANDLES.clear();
};
