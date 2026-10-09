// Opens the index for a query: resolves the project root from cwd, runs the mtime sync for the
// requested (or default) scope, and returns the db with a description of what it covers.
import path from 'node:path';
import { syncSearchIndex } from './search-sync.js';
import { resolveIndexRoot, resolveDefaultScopeDir } from './search-root.js';
import { describeIndexFromSync } from './search-output.js';

// options.includeHeldScopes: graph answers (blast, def, trace...) read every held scope, so
// those scopes are walked too, not only re-stat'd.
export const openSyncedIndex = (cwd = process.cwd(), dir = null, options = {}) => {
  const root = resolveIndexRoot(cwd);
  const hasDir = typeof dir === 'string' && dir.length > 0;
  const scopeTarget = hasDir ? dir : path.resolve(root, resolveDefaultScopeDir(root));
  const syncRes = syncSearchIndex(scopeTarget, cwd, options);
  const hasDb = Boolean(syncRes?.db);
  if (!hasDb) return { db: null, root, index: null };
  return { db: syncRes.db, root, index: describeIndexFromSync(syncRes) };
};
