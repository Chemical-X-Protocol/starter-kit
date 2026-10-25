/**
 * Chemical X Protocol: seed a worktree's index from its parent checkout (#6769, K8b).
 * A fresh worktree's first query parsed every file (5-7 s per 1,400 files) because `.chemx/index.db`
 * is per checkout and the parent's db cannot be copied: it also holds the board, and it is stamped
 * for its root. The seed copies only index rows, and only for files whose bytes hash to the parent
 * row's content_hash, so a copied row describes exactly the file in the worktree; everything else is
 * parsed by the sync that follows. Copied: files, symbols, props, hooks, imports, embeddings, fts_index
 * (INDEX_ROW_TABLES, what a version reset wipes) and the parent's scope key. Never copied: project_stamp
 * (the worktree's own is written at open), violations and audit_snapshots (audit output; the worktree's
 * audit rebuilds them), pattern_* (forge, own stamp) and every team, lease, feed, agent and usage table.
 * The parent db is ATTACHed read-only with a short busy timeout: a busy or unreadable parent means
 * "skipped", with the reason, never a wait or a throw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { locateParentIndex } from './index-seed-parent.js';
import { hashContent } from './index-row-check.js';
import { INDEX_VERSION, readIndexMeta, writeIndexMeta } from './search-index-meta.js';
import { withImmediateTransaction, isSqliteBusyError } from './team/team-db-transaction.js';
import { withoutBusyRetry } from './team/coordination-busy.js';
import { debugNote } from './search-debug.js';

export const SEED_BUSY_TIMEOUT_MS = 500;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const PARENT = 'parent';

// Column lists are explicit so AUTOINCREMENT ids are not carried over. imports is keyed by importer_path.
const ROW_TABLES = [
  { table: 'symbols', pathColumn: 'file_path', columns: 'file_path, name, kind, is_export, start_line, end_line, signature' },
  { table: 'props', pathColumn: 'file_path', columns: 'file_path, name, prop_type' },
  { table: 'hooks', pathColumn: 'file_path', columns: 'file_path, name' },
  { table: 'imports', pathColumn: 'importer_path', columns: 'importer_path, imported_symbol, source_module, resolved_path, line' },
  { table: 'embeddings', pathColumn: 'file_path', columns: 'file_path, target_type, target_name, vector, dimensions, model, updated_at' },
  { table: 'fts_index', pathColumn: 'file_path', columns: 'file_path, name, kind, tier, tokens' }
];
// files columns taken from the parent row; mtime, size and synced_at are the worktree's own.
const FILE_COLUMNS = 'tier, lines, chars, health_score, hazard_count, extractor_version, content_hash';

const none = (reason) => ({ status: 'none', reason });
const skipped = (reason) => ({ status: 'skipped', reason });

const countRows = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c || 0);

// SQLite URI: each path segment percent-encoded, so spaces, '?' and '#' in a path survive.
const toReadOnlyUri = (dbPath) => `file:${dbPath.split(path.sep).map(encodeURIComponent).join('/')}?mode=ro`;

const attachParent = (db, dbPath) => {
  db.exec(`PRAGMA busy_timeout = ${SEED_BUSY_TIMEOUT_MS};`);
  db.prepare(`ATTACH DATABASE ? AS ${PARENT}`).run(toReadOnlyUri(dbPath));
};

const detachParent = (db, isAttached) => {
  if (isAttached) {
    try { db.exec(`DETACH DATABASE ${PARENT};`); } catch (err) { debugNote.warn('detach parent index', err); }
  }
  db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS};`);
};

// The parent's rows are usable when this extractor built them and they carry content hashes.
const whyParentUnusable = (db) => {
  const version = Number(db.prepare(`SELECT value FROM ${PARENT}.index_meta WHERE key = 'version'`).get()?.value);
  const isSameVersion = version === INDEX_VERSION;
  const versionLabel = Number.isFinite(version) ? `v${version}` : 'unversioned';
  if (!isSameVersion) return `the parent index is extractor ${versionLabel}, this chemx is v${INDEX_VERSION}`;
  const hasHashColumn = db.prepare(`PRAGMA ${PARENT}.table_info(files)`).all().some((column) => column.name === 'content_hash');
  return hasHashColumn ? null : 'the parent index has no content hashes (an older chemx built it)';
};

const readParentCandidates = (db) => db.prepare(
  `SELECT path, content_hash FROM ${PARENT}.files WHERE extractor_version = ? AND content_hash IS NOT NULL`
).all(INDEX_VERSION);

// A row is copied only when the worktree file's bytes hash to its content_hash. mtime and size are the
// worktree's: a checkout gives every file a new mtime, so the parent's would make every row stale.
const matchRow = (root, row) => {
  const fullPath = path.join(root, row.path);
  const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
  const isFile = stat?.isFile() === true;
  if (!isFile) return null;
  const isSameContent = hashContent(fs.readFileSync(fullPath, 'utf-8')) === row.content_hash;
  return isSameContent ? { path: row.path, mtime: Math.floor(stat.mtimeMs), size: stat.size } : null;
};

const matchRows = (root, rows) => {
  const matched = [];
  for (const row of rows) {
    try {
      const match = matchRow(root, row);
      if (match) matched.push(match);
    } catch (err) {
      // Unreadable here means unmatched: the sync parses (or reports) the file itself.
      debugNote.warn(`seed match ${row.path}`, err);
    }
  }
  return matched;
};

const insertFiles = (db, matched, syncedAt) => {
  const insert = db.prepare(`INSERT INTO main.files (path, mtime, size, ${FILE_COLUMNS}, synced_at)
    SELECT path, ?, ?, ${FILE_COLUMNS}, ? FROM ${PARENT}.files WHERE path = ?`);
  for (const file of matched) insert.run(file.mtime, file.size, syncedAt, file.path);
};

const copyRowTables = (db) => {
  for (const { table, pathColumn, columns } of ROW_TABLES) {
    db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM ${PARENT}.${table} WHERE ${pathColumn} IN (SELECT path FROM main.files);`);
  }
};

// The scope key says which dirs the rows cover; without it the sync would prune them as orphans.
const copyScopeKey = (db) => {
  const hasOwnScope = Boolean(readIndexMeta(db).scope);
  if (hasOwnScope) return;
  const parentScope = db.prepare(`SELECT value FROM ${PARENT}.index_meta WHERE key = 'scope'`).get()?.value;
  if (parentScope) writeIndexMeta(db, { scope: parentScope });
};

// Inside the worktree db's write transaction, so the emptiness re-check holds when two first syncs race
// (the loser sees rows and copies nothing) and the copy lands whole or not at all.
const seedInsideTransaction = (db, root, parent, startedAt) => {
  const isStillEmpty = countRows(db, 'main.files') === 0;
  if (!isStillEmpty) return skipped('another process filled this index first');
  const problem = whyParentUnusable(db);
  if (problem) return skipped(`${problem}; from ${parent.mainRoot}`);
  const parentFiles = countRows(db, `${PARENT}.files`);
  const matched = matchRows(root, readParentCandidates(db));
  const hasMatches = matched.length > 0;
  if (!hasMatches) return skipped(`none of the ${parentFiles} files in the index of ${parent.mainRoot} match this worktree`);
  insertFiles(db, matched, startedAt);
  copyRowTables(db);
  copyScopeKey(db);
  return { status: 'seeded', seeded: matched.length, parentFiles, mainRoot: parent.mainRoot, ms: Date.now() - startedAt };
};

const describeFailure = (err, parent) => {
  debugNote.warn(`seed from ${parent.dbPath}`, err);
  const isBusy = isSqliteBusyError(err);
  if (isBusy) return skipped(`a database is busy (the parent index ${parent.dbPath}, or this one, is held by another chemx); indexing from disk instead`);
  return skipped(`the parent index ${parent.dbPath} could not be read (${err?.message || err}); indexing from disk instead`);
};

// The busy retry (coordination-busy.js) is off for the whole seed: a held parent fails after the short
// busy_timeout instead of the 30 s deadline, and the sync then parses the files itself.
const seedFrom = (db, root, parent, startedAt) => withoutBusyRetry(db, () => {
  let isAttached = false;
  try {
    attachParent(db, parent.dbPath);
    isAttached = true;
    return withImmediateTransaction(db, () => seedInsideTransaction(db, root, parent, startedAt), 1);
  } catch (err) {
    return describeFailure(err, parent);
  } finally {
    detachParent(db, isAttached);
  }
});

/**
 * Seeds an EMPTY index db from the parent checkout's. options.locate replaces locateParentIndex (specs).
 * @returns {{ status: 'seeded', seeded: number, parentFiles: number, mainRoot: string, ms: number }
 *   | { status: 'skipped', reason: string } | { status: 'none', reason: string }}
 *   'none' is nothing to do (rows already, not a worktree, parent has no index); 'skipped' is a parent that
 *   exists but could not be used, worth a line in the output.
 */
export const seedIndexFromParent = (db, root, options = {}) => {
  const startedAt = Date.now();
  const hasRows = countRows(db, 'files') > 0;
  if (hasRows) return none('the index already has rows');
  const locate = options.locate ?? locateParentIndex;
  const parent = locate(root);
  const hasParent = parent.status === 'found';
  if (!hasParent) return none(parent.reason);
  return seedFrom(db, root, parent, startedAt);
};

const SEED_TEXT = {
  seeded: (seed) => `seeded ${seed.seeded} of ${seed.parentFiles} files from ${seed.mainRoot}`,
  skipped: (seed) => `seed from parent skipped: ${seed.reason}`,
  none: () => ''
};

/** One clause for the index line; '' when there is nothing to say. */
export const describeSeed = (seed) => {
  const describe = SEED_TEXT[seed?.status];
  return describe ? describe(seed) : '';
};
