// Opens the index for a query: the scope sync of ensureFresh (index-freshness.js) for the
// requested dir, or the project scope when dir is null. Kept as the graph and MCP q entry point.
import { ensureFresh } from './index-freshness.js';

// options.includeHeldScopes: graph answers (blast, def, trace...) read every held scope, so
// those scopes are walked too, not only re-stat'd. options.paths: files at hand, synced first.
export const openSyncedIndex = (cwd = process.cwd(), dir = null, options = {}) => {
  const hasDir = typeof dir === 'string' && dir.length > 0;
  const session = ensureFresh(cwd, { ...options, scope: hasDir ? dir : null });
  return { db: session.db, root: session.root, index: session.index };
};
