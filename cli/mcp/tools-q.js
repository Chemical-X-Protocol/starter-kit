import { syncSearchIndex } from '../search.js';
import { openIndexDb, queryIndex } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import { resolveTargetCwd } from './tools-search-util.js';
import {
  executeBlastRadiusQuery, executeSemanticQuery,
  executeHybridQuery, executeConnectionsQuery, executeFtsFallback
} from './tools-q-modes.js';

export const handleChemxQ = (args = {}, cwd = process.cwd()) => {
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const query = args.query || args.symbol;
  if (!query) throw new Error('chemx_q requires "query" or "symbol" argument.');
  const db = openIndexDb(targetCwd);
  if (!db) syncSearchIndex('src', targetCwd);
  const activeDb = openIndexDb(targetCwd);
  if (!activeDb) throw new Error('Unable to initialize Chemical X AST search index database.');

  if (args.blastRadius || args.impact) return executeBlastRadiusQuery(activeDb, query, args);
  if (args.semantic) return executeSemanticQuery(activeDb, query, args);
  if (args.hybrid) return executeHybridQuery(activeDb, query, args);

  if (args.connections || args.symbol) {
    const conn = executeConnectionsQuery(activeDb, query);
    if (conn) return conn;
  }

  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const results = queryIndex(activeDb, { query, tier: args.tier || 'all', limit });

  if (args.columnar) {
    return toColumnar(results, ['path', 'tier', 'lines', 'symbols', 'props', 'hooks'], {
      symbols: (r) => (r.symbols || []).map((s) => s.name),
      props: (r) => (r.props || []).map((p) => p.name),
      hooks: (r) => r.hooks || []
    });
  }

  if (args.inspect) {
    return results.map((r) => ({
      path: r.path, tier: r.tier, lines: r.lines,
      symbols: (r.symbols || []).map((s) => s.name),
      props: (r.props || []).map((p) => p.name),
      hooks: r.hooks || []
    }));
  }

  const lines = results.map((r) => {
    const mainSym = (r.symbols || []).find((s) => s.isExport)?.name || '';
    const symPart = mainSym ? ` (${mainSym})` : '';
    const hookPart = r.hooks && r.hooks.length > 0 ? ` [${r.hooks.slice(0, 2).join(',')}]` : '';
    return `[${r.tier.toUpperCase()}] ${r.path}:${r.lines}L${symPart}${hookPart}`;
  });

  if (lines.length > 0) return lines.join('\n');
  const fts = executeFtsFallback(activeDb, query);
  return fts || `No matching capsules or symbols for "${query}"`;
};
