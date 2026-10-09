// The one freshness primitive for every reader of .chemx/index.db (#2552).
// ensureFresh syncs the files at hand first (search-sync-paths.js: one stat each, a content hash
// only for a racy row), then the scope the answer depends on (search-sync.js), and returns the db
// with a freshness stamp the answer prints as its last index line, for example
//   index: scope . (966 files) under <root>; synced 966 files, 3 re-indexed, 0 removed, 41ms
// Guarantee: when index.status is pass, every row the answer can read was compared with its file
// on disk during this call (mtime + size, and the content hash when the row is racy); files
// deleted or renamed on disk have no rows. When the db is read-only, another process held the
// write lock past busy_timeout, or a scope dir is missing, index.status is inconclusive and
// index.reason says why: the answer then comes from the rows as they were.
import path from 'node:path';
import { STATUS } from './result-status.js';
import { openIndexDb, getIndexDbState } from './search-schema.js';
import { syncSearchIndex } from './search-sync.js';
import { syncPathRows } from './search-sync-paths.js';
import { resolveIndexRoot, resolveDefaultScopeDir } from './search-root.js';
import { describeIndexFromSync, describePathsIndex } from './search-output.js';

export { formatFreshness } from './search-output.js';

const EMPTY_TALLY = Object.freeze({ checked: 0, reindexed: 0, removed: 0, hashed: 0, notIndexed: [], skipped: [], status: 'fresh', reason: null });

const resolveScopeTarget = (root, scope) => {
  const hasScope = Array.isArray(scope) ? scope.length > 0 : typeof scope === 'string' && scope.length > 0;
  return hasScope ? scope : path.resolve(root, resolveDefaultScopeDir(root));
};

// checked counts distinct files compared with disk: a scope sync also re-stats every row the files
// at hand have, so with a scope its count already covers them.
const toFreshness = (tally, syncRes, ms) => ({
  checked: syncRes ? Number(syncRes.checkedCount ?? syncRes.totalFiles ?? 0) : tally.checked,
  reindexed: tally.reindexed + Number(syncRes?.updatedCount || 0),
  removed: tally.removed + Number(syncRes?.removedCount || 0),
  hashed: tally.hashed + Number(syncRes?.hashedCount || 0),
  notIndexed: tally.notIndexed,
  ms
});

const syncScope = (cwd, root, options) => {
  const target = resolveScopeTarget(root, options.scope);
  return syncSearchIndex(target, cwd, {
    reindex: Boolean(options.reindex),
    includeInternal: Boolean(options.includeInternal),
    includeHeldScopes: Boolean(options.includeHeldScopes)
  });
};

// The write lock was held past busy_timeout while the db opened: nothing was synced, so say so.
const busyAtOpenIndex = (startedAt) => ({
  status: STATUS.INCONCLUSIVE,
  reason: 'index busy at open: another process held the write lock past the busy timeout; the rows are as they were',
  freshness: { checked: 0, reindexed: 0, removed: 0, hashed: 0, notIndexed: [], ms: Math.round(performance.now() - startedAt) }
});

/**
 * @param {string} cwd Where chemx runs (the index root is the nearest .chemx above it).
 * @param {object} [options] { paths: files at hand, synced first; scope: dir(s) relative to cwd, or
 *   null for the project scope, or false for the files at hand only; includeHeldScopes, reindex,
 *   includeInternal (as in syncSearchIndex) }
 * @returns {{ db, root, index, freshness }} db is null when SQLite is unavailable.
 */
export const ensureFresh = (cwd = process.cwd(), options = {}) => {
  const startedAt = performance.now();
  const root = resolveIndexRoot(cwd);
  const db = openIndexDb(cwd);
  const hasDb = Boolean(db);
  if (!hasDb) return { db: null, root, index: null, freshness: null };
  const isBusyAtOpen = getIndexDbState(db).isBusyAtOpen;
  if (isBusyAtOpen) return { db, root, index: busyAtOpenIndex(startedAt), freshness: null };
  const paths = Array.isArray(options.paths) ? options.paths.filter(Boolean) : [];
  const tally = paths.length > 0 ? syncPathRows(db, paths, cwd) : EMPTY_TALLY;
  const wantsScope = options.scope !== false;
  const syncRes = wantsScope ? syncScope(cwd, root, options) : null;
  const freshness = toFreshness(tally, syncRes, Math.round(performance.now() - startedAt));
  const baseIndex = wantsScope ? describeIndexFromSync(syncRes) : describePathsIndex(db, root, tally);
  const isPathSyncStale = tally.status !== 'fresh';
  const index = isPathSyncStale ? { ...baseIndex, status: STATUS.INCONCLUSIVE, reason: tally.reason } : baseIndex;
  return { db: syncRes?.db || db, root, index: { ...index, freshness }, freshness };
};
