// mtime/size sync of the AST index for one scope of one project root.
// The index keeps every scope it has synced (index_meta.scope, a comma list). A sync walks the
// requested scope (plus every held scope for graph queries) and re-stats every other stored
// row, so no query ever reads a row for a file that was deleted or changed on disk.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb, getIndexDbState } from './search-schema.js';
import { getAllIndexedFiles } from './search-db.js';
import { upsertFileIndex, deleteFileIndexRows, stampRowsSynced } from './search-index-write.js';
import { readIndexMeta, describeVersionReset } from './search-index-meta.js';
import { resolveIndexRoot, normalizeScope, isPathInScope, isScopeCovered, toRootRelative } from './search-root.js';
import { scanScope } from './search-scan.js';
import { isSqliteBusyError } from './team/team-db-transaction.js';
import { debugNote } from './search-debug.js';
import { parseIndexRecord, collectRecords, revalidateOtherRows, findDroppedRows } from './search-sync-rows.js';
import { planWalkedScope, hasPlannedChanges, commitSyncPlan } from './search-sync-plan.js';

export { parseIndexRecord };

const LARGE_SYNC_THRESHOLD = 200;
// A query waits once on busy_timeout, then answers from the current rows as stale.
const SYNC_WRITE_ATTEMPTS = 2;

const staleResult = (db, root, scope, reason, status = 'stale') => ({
  db, root, scopeDirs: scope.scopeDirs, scope: scope.scopeKey, requestedScope: scope.scopeKey, status, staleReason: reason,
  updatedCount: 0, removedCount: 0, totalFiles: 0, skippedFiles: [], versionNotice: null, indexedScopes: null
});

const resolveScopeDirs = (targetDir, cwd, options) => {
  const dirs = Array.isArray(targetDir) ? [...targetDir] : [targetDir];
  const hasInternalDir = options.includeInternal && fs.existsSync(path.resolve(cwd, 'cli'));
  if (hasInternalDir) dirs.push('cli');
  return dirs;
};

// options: { reindex, includeInternal, includeHeldScopes }
export const syncSearchIndex = (targetDir = 'src', cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  if (!db) return null;
  const root = resolveIndexRoot(cwd);
  const requested = normalizeScope(resolveScopeDirs(targetDir, cwd, options), root, cwd);
  const state = getIndexDbState(db);

  const hasOutsideDirs = requested.outside.length > 0;
  if (hasOutsideDirs) return staleResult(db, root, requested, `outside project root ${root}: ${requested.outside.join(', ')}`);
  if (state.isReadOnly) return staleResult(db, root, requested, 'index db is read-only; rows were not refreshed');

  // Rows before meta: a scope merged in between shows up as a key with no rows (re-walked
  // later), never as rows with no covering key (which would read as orphans).
  const indexedMap = getAllIndexedFiles(db);
  const meta = readIndexMeta(db);
  const walk = planWalkedScope(requested.scopeDirs, meta.scope, root, Boolean(options.includeHeldScopes));
  const { files, unreadable, missing } = scanScope(root, walk.walkedDirs);
  const hasMissingDirs = missing.length > 0;
  if (hasMissingDirs) return staleResult(db, root, requested, `scope dir not found under ${root}: ${missing.join(', ')}`, 'missing');

  const scannedPaths = new Set(files.map((f) => f.relPath));
  const others = revalidateOtherRows(indexedMap, walk.walkedDirs, meta.scope, root);
  const inScope = collectRecords(files, indexedMap, root, options);
  const outScope = collectRecords(others.existing, indexedMap, root, { reindex: false });
  const skippedFiles = [...unreadable, ...inScope.skippedFiles];
  const skippedPaths = new Set([...skippedFiles, ...outScope.skippedFiles].map((f) => f.path));
  const isEmptyScope = !files.some((f) => isPathInScope(f.relPath, requested.scopeDirs));
  const plan = {
    records: [...inScope.records, ...outScope.records],
    removable: [...others.gone, ...findDroppedRows(indexedMap, walk.walkedDirs, scannedPaths, skippedPaths)],
    orphans: others.orphans,
    addDirs: isEmptyScope ? [] : requested.scopeDirs,
    dropDirs: walk.vanished
  };

  let committed = { scopeKey: meta.scope, removedCount: 0 };
  try {
    const hasChanges = hasPlannedChanges(plan, meta.scope);
    if (hasChanges) committed = commitSyncPlan(db, plan, SYNC_WRITE_ATTEMPTS);
  } catch (err) {
    const isBusy = isSqliteBusyError(err);
    if (!isBusy) throw err;
    debugNote.warn('sync write lock', err);
    return staleResult(db, root, requested, 'index busy: another chemx process holds the write lock; rows were not refreshed');
  }
  // Racy rows proven by their content hash: a new synced_at, best effort and lock-free (a no-op
  // sync never waits for the write lock).
  stampRowsSynced(db, [...inScope.touched, ...outScope.touched]);
  const isLargeSync = plan.records.length + committed.removedCount > LARGE_SYNC_THRESHOLD;
  if (isLargeSync) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (err) { debugNote.warn('wal checkpoint', err); }
  }

  const versionNotice = state.versionReset ? describeVersionReset(state.versionReset) : null;
  state.versionReset = null;
  return {
    db, root, scopeDirs: walk.walkedDirs, scope: walk.walkedKey, requestedScope: requested.scopeKey,
    status: isEmptyScope ? 'empty' : 'fresh',
    staleReason: isEmptyScope ? `no indexable source files in scope ${requested.scopeKey}` : null,
    updatedCount: plan.records.length, removedCount: committed.removedCount, totalFiles: files.length, skippedFiles, versionNotice,
    indexedScopes: committed.scopeKey,
    // Files compared with disk (walked scope plus re-stat'd rows outside it) and racy rows hashed.
    checkedCount: inScope.checked + outScope.checked, hashedCount: inScope.hashed + outScope.hashed
  };
};

// Re-indexes one file after a write. Files outside every stored scope are not indexed, so a
// write to scratch/ never leaks into default-scope answers.
export const syncSingleFileIndex = (targetPath, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return null;
  const root = resolveIndexRoot(cwd);
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  const relPath = toRootRelative(fullPath, root);
  const isMissing = !fs.existsSync(fullPath);
  if (isMissing) {
    deleteFileIndexRows(db, [relPath]);
    return { db, status: 'deleted', path: relPath };
  }

  const meta = readIndexMeta(db);
  const hasStoredScope = Boolean(meta.scope);
  const isOutOfScope = hasStoredScope && !isScopeCovered([relPath], meta.scope);
  if (isOutOfScope) return { db, status: 'out-of-scope', path: relPath, scope: meta.scope };

  const record = parseIndexRecord(fullPath, relPath, root);
  upsertFileIndex(db, record);
  return {
    db, status: 'indexed', path: relPath, tier: record.tier, lines: record.lines,
    symbolsCount: record.symbols.length, propsCount: record.props.length, hooksCount: record.hooks.length
  };
};
