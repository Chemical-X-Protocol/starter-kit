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

// Key before rows: a new scope dir joins the key before any of its rows are written. A concurrent
// sync reads rows before meta (search-sync.js), so it may see the key without all of the dir's rows,
// which it re-walks, but never rows that no stored scope covers, which it would prune as orphans.
const mergeAddedDirs = (db, addDirs, attempts) => {
  const storedKey = readIndexMeta(db).scope || '';
  const isCovered = computeNextScopeKey(storedKey, { addDirs }) === storedKey;
  if (isCovered) return;
  withIndexTransaction(db, () => {
    writeIndexMeta(db, { scope: computeNextScopeKey(readIndexMeta(db).scope, { addDirs }) });
  }, attempts);
};

// The rows go in short transactions (upsertFileIndexBatch), never one around the whole sync: that
// held the shared write lock for 88 s on a stale root index and starved every team write (#5919).
// Each file's rows are written whole and match the file as parsed, so a busy failure or a crash
// before the commit below leaves only true rows, under a key that covers them. At the commit the
// key is re-read under the write lock, so a scope another process merged after this sync read meta
// is kept, and its rows are not pruned as orphans.
export const commitSyncPlan = (db, plan, attempts) => {
  const committed = { scopeKey: null, removedCount: 0 };
  mergeAddedDirs(db, plan.addDirs, attempts);
  upsertFileIndexBatch(db, plan.records, { attempts });
  withIndexTransaction(db, () => {
    const currentKey = readIndexMeta(db).scope;
    const scopeKey = computeNextScopeKey(currentKey, plan);
    const orphans = plan.orphans.filter((relPath) => !isScopeCovered([relPath], scopeKey));
    const removable = [...plan.removable, ...orphans];
    deleteFileIndexRows(db, removable);
    writeIndexMeta(db, { scope: scopeKey, syncedAt: Date.now() });
    committed.scopeKey = scopeKey;
    committed.removedCount = removable.length;
  }, attempts);
  return committed;
};
