// mtime/size sync of the AST index for one scope of one project root.
// The index keeps every scope it has synced (index_meta.scope, a comma list). A sync rescans
// the requested scope and re-stats every other stored row, so no query ever reads a row for a
// file that was deleted or changed on disk, whichever scope last refreshed it.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb, getIndexDbState } from './search-schema.js';
import { getAllIndexedFiles } from './search-db.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { upsertFileIndex, upsertFileIndexBatch, deleteFileIndexRows, withIndexTransaction } from './search-index-write.js';
import { readIndexMeta, writeIndexMeta, describeVersionReset, INDEX_VERSION } from './search-index-meta.js';
import { resolveIndexRoot, normalizeScope, isPathInScope, isScopeCovered, toRootRelative, mergeScopeKeys } from './search-root.js';
import { scanScope } from './search-scan.js';
import { isSqliteBusyError } from './team/team-db-transaction.js';
import { debugNote } from './search-debug.js';

const LARGE_SYNC_THRESHOLD = 200;
// A query waits once on busy_timeout, then answers from the current rows as stale.
const SYNC_WRITE_ATTEMPTS = 2;

export const parseIndexRecord = (fullPath, relPath, root) => {
  const stat = fs.statSync(fullPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const { symbols, props, hooks, imports } = extractAstMetadata(content, fullPath);
  return {
    path: relPath, root, mtime: Math.floor(stat.mtimeMs), size: stat.size,
    tier: resolveArchitectureTier(relPath), lines: content.split('\n').length, chars: content.length,
    symbols, props, hooks, imports
  };
};

const isUnchanged = (cached, fullPath) => {
  const hasCurrentRow = Boolean(cached) && cached.version === INDEX_VERSION;
  if (!hasCurrentRow) return false;
  const stat = fs.statSync(fullPath);
  return cached.mtime === Math.floor(stat.mtimeMs) && cached.size === stat.size;
};

const staleResult = (db, root, scope, reason, status = 'stale') => ({
  db, root, scopeDirs: scope.scopeDirs, scope: scope.scopeKey, status, staleReason: reason,
  updatedCount: 0, removedCount: 0, totalFiles: 0, skippedFiles: [], versionNotice: null, indexedScopes: null
});

const resolveScopeDirs = (targetDir, cwd, options) => {
  const dirs = Array.isArray(targetDir) ? [...targetDir] : [targetDir];
  const hasInternalDir = options.includeInternal && fs.existsSync(path.resolve(cwd, 'cli'));
  if (hasInternalDir) dirs.push('cli');
  return dirs;
};

// Parses new or changed files; a file that cannot be read is skipped and its row dropped.
const collectRecords = (entries, indexedMap, root, options) => {
  const records = [];
  const skippedFiles = [];
  for (const { fullPath, relPath } of entries) {
    try {
      const isFresh = !options.reindex && isUnchanged(indexedMap.get(relPath), fullPath);
      if (isFresh) continue;
      records.push(parseIndexRecord(fullPath, relPath, root));
    } catch (err) {
      skippedFiles.push({ path: relPath, reason: err?.message || String(err) });
      debugNote.warn(`skipped ${relPath}`, err);
    }
  }
  return { records, skippedFiles };
};

// Rows outside the requested scope: orphans (no stored scope covers them) and deleted files go,
// changed files are re-parsed. A stat per row, no directory walk.
const revalidateOtherRows = (indexedMap, scopeDirs, storedKey, root) => {
  const removable = [];
  const existing = [];
  for (const relPath of indexedMap.keys()) {
    const isInRequestedScope = isPathInScope(relPath, scopeDirs);
    if (isInRequestedScope) continue;
    const fullPath = path.join(root, relPath);
    const isOrphan = !isScopeCovered([relPath], storedKey);
    const isGone = isOrphan || !fs.existsSync(fullPath);
    if (isGone) removable.push(relPath);
    else existing.push({ fullPath, relPath });
  }
  return { removable, existing };
};

export const syncSearchIndex = (targetDir = 'src', cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  if (!db) return null;
  const root = resolveIndexRoot(cwd);
  const scope = normalizeScope(resolveScopeDirs(targetDir, cwd, options), root, cwd);
  const state = getIndexDbState(db);

  const hasOutsideDirs = scope.outside.length > 0;
  if (hasOutsideDirs) return staleResult(db, root, scope, `outside project root ${root}: ${scope.outside.join(', ')}`);
  if (state.isReadOnly) return staleResult(db, root, scope, 'index db is read-only; rows were not refreshed');

  const { files, unreadable, missing } = scanScope(root, scope.scopeDirs);
  const hasMissingDirs = missing.length > 0;
  if (hasMissingDirs) return staleResult(db, root, scope, `scope dir not found under ${root}: ${missing.join(', ')}`, 'missing');

  const meta = readIndexMeta(db);
  const indexedMap = getAllIndexedFiles(db);
  const scannedPaths = new Set(files.map((f) => f.relPath));
  const others = revalidateOtherRows(indexedMap, scope.scopeDirs, meta.scope, root);
  const inScope = collectRecords(files, indexedMap, root, options);
  const outScope = collectRecords(others.existing, indexedMap, root, { reindex: false });
  const records = [...inScope.records, ...outScope.records];
  const skippedFiles = [...unreadable, ...inScope.skippedFiles];
  const skippedPaths = new Set([...skippedFiles, ...outScope.skippedFiles].map((f) => f.path));
  const removable = [
    ...others.removable,
    ...Array.from(indexedMap.keys()).filter((p) => skippedPaths.has(p) || (isPathInScope(p, scope.scopeDirs) && !scannedPaths.has(p)))
  ];

  const nextScopeKey = mergeScopeKeys(meta.scope, scope.scopeDirs);
  const hasChanges = records.length > 0 || removable.length > 0 || nextScopeKey !== meta.scope;
  try {
    if (hasChanges) {
      withIndexTransaction(db, () => {
        upsertFileIndexBatch(db, records);
        deleteFileIndexRows(db, removable);
        writeIndexMeta(db, { scope: nextScopeKey, syncedAt: Date.now() });
      }, SYNC_WRITE_ATTEMPTS);
    }
  } catch (err) {
    const isBusy = isSqliteBusyError(err);
    if (!isBusy) throw err;
    debugNote.warn('sync write lock', err);
    return staleResult(db, root, scope, 'index busy: another chemx process holds the write lock; rows were not refreshed');
  }
  const isLargeSync = records.length + removable.length > LARGE_SYNC_THRESHOLD;
  if (isLargeSync) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (err) { debugNote.warn('wal checkpoint', err); }
  }

  const versionNotice = state.versionReset ? describeVersionReset(state.versionReset) : null;
  state.versionReset = null;
  const isEmptyScope = files.length === 0;
  return {
    db, root, scopeDirs: scope.scopeDirs, scope: scope.scopeKey,
    status: isEmptyScope ? 'empty' : 'fresh',
    staleReason: isEmptyScope ? `no indexable source files in scope ${scope.scopeKey}` : null,
    updatedCount: records.length, removedCount: removable.length, totalFiles: files.length, skippedFiles, versionNotice,
    indexedScopes: hasChanges ? nextScopeKey : meta.scope
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
