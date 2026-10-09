// Row-level decisions for one index sync: which files to (re)parse and which rows to drop.
import fs from 'node:fs';
import path from 'node:path';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';
import { INDEX_VERSION } from './search-index-meta.js';
import { isPathInScope, isScopeCovered } from './search-root.js';
import { debugNote } from './search-debug.js';

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

// Parses new or changed files; a file that cannot be read is skipped and its row dropped.
export const collectRecords = (entries, indexedMap, root, options) => {
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
