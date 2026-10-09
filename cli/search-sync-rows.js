// Row-level decisions for one index sync: which files to (re)parse and which rows to drop.
import fs from 'node:fs';
import path from 'node:path';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { checkRowAgainstDisk, hashContent } from './index-row-check.js';
import { isPathInScope, isScopeCovered } from './search-root.js';
import { debugNote } from './search-debug.js';
import { conflictHunksOf, describeConflicts } from './conflicts.js';

// An unmerged file would index garbage symbols (both sides, or a parse failure): skip it.
const refuseConflicted = (content, relPath) => {
  const hunks = conflictHunksOf(content);
  const isConflicted = hunks.length > 0;
  if (!isConflicted) return;
  const err = new Error(describeConflicts(relPath, hunks));
  err.conflictLine = hunks[0].start;
  throw err;
};

// syncedAt is taken before the stat, so a write racing this parse leaves the row racy
// (index-row-check.js) and the next sync compares content hashes instead of trusting mtime.
export const parseIndexRecord = (fullPath, relPath, root) => {
  const syncedAt = Date.now();
  const stat = fs.statSync(fullPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  refuseConflicted(content, relPath);
  const { symbols, props, hooks, imports } = extractAstMetadata(content, fullPath);
  return {
    path: relPath, root, mtime: Math.floor(stat.mtimeMs), size: stat.size,
    tier: resolveArchitectureTier(relPath), lines: content.split('\n').length, chars: content.length,
    contentHash: hashContent(content), syncedAt,
    symbols, props, hooks, imports
  };
};

// Re-checks one row: 'fresh' and 'racy-clean' rows are kept (racy-clean ones get a new synced_at
// stamp in `touched`), anything else is re-parsed. --reindex re-parses every file.
const checkEntry = (acc, cached, fullPath, relPath, options) => {
  acc.checked += 1;
  const isForced = Boolean(options.reindex);
  const check = isForced ? { verdict: 'stale', hashed: false } : checkRowAgainstDisk(cached, fullPath);
  acc.hashed += check.hashed ? 1 : 0;
  const isRacyClean = check.verdict === 'racy-clean';
  if (isRacyClean) acc.touched.push({ path: relPath, syncedAt: acc.startedAt });
  return check.verdict === 'stale';
};

// Parses new or changed files; a file that cannot be read is skipped and its row dropped.
// Returns { records, skippedFiles, touched, checked, hashed }.
export const collectRecords = (entries, indexedMap, root, options) => {
  const records = [];
  const skippedFiles = [];
  const acc = { touched: [], checked: 0, hashed: 0, startedAt: Date.now() };
  for (const { fullPath, relPath } of entries) {
    try {
      const needsParse = checkEntry(acc, indexedMap.get(relPath), fullPath, relPath, options);
      if (!needsParse) continue;
      records.push(parseIndexRecord(fullPath, relPath, root));
    } catch (err) {
      const conflict = err?.conflictLine ? { conflictLine: err.conflictLine } : {};
      skippedFiles.push({ path: relPath, reason: err?.message || String(err), ...conflict });
      debugNote.warn(`skipped ${relPath}`, err);
    }
  }
  return { records, skippedFiles, touched: acc.touched, checked: acc.checked, hashed: acc.hashed };
};

// Rows outside the walked scope, a stat per row and no directory walk: deleted files are gone,
// changed files are re-parsed, and orphans (no stored scope covers them) are only candidates,
// re-checked at commit against the scope key read under the write lock.
export const revalidateOtherRows = (indexedMap, walkedDirs, storedKey, root) => {
  const gone = [];
  const orphans = [];
  const existing = [];
  for (const relPath of indexedMap.keys()) {
    const isWalked = isPathInScope(relPath, walkedDirs);
    if (isWalked) continue;
    const isOrphan = !isScopeCovered([relPath], storedKey);
    if (isOrphan) {
      orphans.push(relPath);
      continue;
    }
    const fullPath = path.join(root, relPath);
    const isGone = !fs.existsSync(fullPath);
    if (isGone) gone.push(relPath);
    else existing.push({ fullPath, relPath });
  }
  return { gone, orphans, existing };
};

// Walked-scope rows the walk no longer finds, plus any row whose file could not be parsed.
export const findDroppedRows = (indexedMap, walkedDirs, scannedPaths, skippedPaths) => Array.from(indexedMap.keys()).filter((relPath) => {
  const isSkipped = skippedPaths.has(relPath);
  const isUnfound = isPathInScope(relPath, walkedDirs) && !scannedPaths.has(relPath);
  return isSkipped || isUnfound;
});
