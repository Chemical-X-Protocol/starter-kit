// mtime/size sync of the AST index for one scope of one project root.
// The index holds a single scope at a time (stamped in index_meta): syncing a scope the
// stored one does not cover prunes every row outside it, so nothing leaks across --dir runs.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb, getIndexDbState } from './search-schema.js';
import { getAllIndexedFiles } from './search-db.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { upsertFileIndex, upsertFileIndexBatch, deleteFileIndexRows, withIndexTransaction } from './search-index-write.js';
import { readIndexMeta, writeIndexMeta, describeVersionReset } from './search-index-meta.js';
import { resolveIndexRoot, normalizeScope, isPathInScope, isScopeCovered, toRootRelative } from './search-root.js';
import { scanScope } from './search-scan.js';
import { debugNote } from './search-debug.js';

const LARGE_SYNC_THRESHOLD = 200;

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
  const hasCachedRow = Boolean(cached);
  if (!hasCachedRow) return false;
  const stat = fs.statSync(fullPath);
  return cached.mtime === Math.floor(stat.mtimeMs) && cached.size === stat.size;
};

const staleResult = (db, root, scope, reason) => ({
  db, root, scopeDirs: scope.scopeDirs, scope: scope.scopeKey, status: 'stale', staleReason: reason,
  updatedCount: 0, removedCount: 0, totalFiles: 0, skippedFiles: [], versionNotice: null
});

const resolveScopeDirs = (targetDir, cwd, options) => {
  const dirs = Array.isArray(targetDir) ? [...targetDir] : [targetDir];
  const hasInternalDir = options.includeInternal && fs.existsSync(path.resolve(cwd, 'cli'));
  if (hasInternalDir) dirs.push('cli');
  return dirs;
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

  const meta = readIndexMeta(db);
  const isCoveredByStoredScope = !options.reindex && isScopeCovered(scope.scopeDirs, meta.scope);
  const { files, unreadable } = scanScope(root, scope.scopeDirs);
  const scannedPaths = new Set(files.map((f) => f.relPath));
  const indexedMap = getAllIndexedFiles(db);

  const records = [];
  const skippedFiles = [...unreadable];
  for (const { fullPath, relPath } of files) {
    try {
      const isFresh = !options.reindex && isUnchanged(indexedMap.get(relPath), fullPath);
      if (isFresh) continue;
      records.push(parseIndexRecord(fullPath, relPath, root));
    } catch (err) {
      skippedFiles.push({ path: relPath, reason: err?.message || String(err) });
      debugNote.warn(`skipped ${relPath}`, err);
    }
  }

  const skippedPaths = new Set(skippedFiles.map((f) => f.path));
  const isOutsideStoredScope = (p) => !isScopeCovered([p], meta.scope);
  const removable = Array.from(indexedMap.keys()).filter((p) => {
    const isInScope = isPathInScope(p, scope.scopeDirs);
    if (isInScope) return !scannedPaths.has(p) || skippedPaths.has(p);
    return !isCoveredByStoredScope || isOutsideStoredScope(p);
  });

  withIndexTransaction(db, () => {
    upsertFileIndexBatch(db, records);
    deleteFileIndexRows(db, removable);
    const storedScope = isCoveredByStoredScope ? meta.scope : scope.scopeKey;
    writeIndexMeta(db, { scope: storedScope, syncedAt: Date.now() });
  });
  const isLargeSync = records.length + removable.length > LARGE_SYNC_THRESHOLD;
  if (isLargeSync) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (err) { debugNote.warn('wal checkpoint', err); }
  }

  const versionNotice = state.versionReset ? describeVersionReset(state.versionReset) : null;
  state.versionReset = null;
  return {
    db, root, scopeDirs: scope.scopeDirs, scope: scope.scopeKey, status: 'fresh', staleReason: null,
    updatedCount: records.length, removedCount: removable.length, totalFiles: files.length, skippedFiles, versionNotice
  };
};

// Re-indexes one file after a write. Files outside the stored scope are not indexed, so a
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
