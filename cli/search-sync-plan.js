// Which dirs one index sync walks, and the scope key it commits.
// A plain query walks only the requested scope. A graph query (includeHeldScopes) also walks
// every scope the index holds, so a new consumer there is found, not just the old rows re-stat'd.
import fs from 'node:fs';
import path from 'node:path';
import { parseScopeKey, mergeScopeKeys, isPathInScope, isScopeCovered } from './search-root.js';
import { readIndexMeta, writeIndexMeta } from './search-index-meta.js';
import { upsertFileIndexBatch, deleteFileIndexRows, withIndexTransaction } from './search-index-write.js';

// Held dirs that no longer exist are dropped from the key instead of failing every graph query.
export const planWalkedScope = (requestedDirs, storedKey, root, includeHeldScopes = false) => {
  const held = includeHeldScopes ? parseScopeKey(storedKey).filter((dir) => !isPathInScope(dir, requestedDirs)) : [];
  const vanished = held.filter((dir) => !fs.existsSync(path.resolve(root, dir)));
  const kept = held.filter((dir) => !vanished.includes(dir));
  const walkedKey = mergeScopeKeys(kept.join(','), requestedDirs);
  return { walkedDirs: parseScopeKey(walkedKey), walkedKey, vanished };
};

// addDirs is empty when the requested scope had no indexable files, so it is never recorded.
export const computeNextScopeKey = (currentKey, { addDirs = [], dropDirs = [] } = {}) => {
  const kept = parseScopeKey(currentKey).filter((dir) => !dropDirs.includes(dir));
  return mergeScopeKeys(kept.join(','), addDirs);
};

export const hasPlannedChanges = (plan, storedKey) => {
  const hasRowChanges = plan.records.length > 0 || plan.removable.length > 0 || plan.orphans.length > 0;
  return hasRowChanges || computeNextScopeKey(storedKey, plan) !== (storedKey || '');
};

// The key is re-read under the write lock, so a scope another process merged after this sync
// read meta is kept, and its rows are not pruned as orphans.
export const commitSyncPlan = (db, plan, attempts) => {
  const committed = { scopeKey: null, removedCount: 0 };
  withIndexTransaction(db, () => {
    const currentKey = readIndexMeta(db).scope;
    const scopeKey = computeNextScopeKey(currentKey, plan);
    const orphans = plan.orphans.filter((relPath) => !isScopeCovered([relPath], scopeKey));
    const removable = [...plan.removable, ...orphans];
    upsertFileIndexBatch(db, plan.records);
    deleteFileIndexRows(db, removable);
    writeIndexMeta(db, { scope: scopeKey, syncedAt: Date.now() });
    committed.scopeKey = scopeKey;
    committed.removedCount = removable.length;
  }, attempts);
  return committed;
};
