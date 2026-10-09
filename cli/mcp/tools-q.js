import { queryIndexPage } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import { formatIndexLine } from '../search-output.js';
import { openSyncedIndex } from '../search-session.js';
import { handleLiteralSearchCommand } from '../search-commands-literal.js';
import { STATUS } from '../result-status.js';
import { resolveTargetCwd } from './tools-search-util.js';
import {
  executeBlastRadiusQuery, executeSemanticQuery,
  executeHybridQuery, executeConnectionsQuery, executeFtsFallback
} from './tools-q-modes.js';

// Every MCP q call runs the mtime sync first (a stat per file), so files created, edited or
// deleted outside chemx (Edit tool, git checkout, editors) are never answered from old rows.
export const syncIndexForQuery = (targetCwd, args = {}) => {
  const session = openSyncedIndex(targetCwd, args.dir);
  const hasDb = Boolean(session.db);
  if (!hasDb) throw new Error('Unable to initialize Chemical X AST search index database.');
  return session;
};

const formatTextHit = (r) => {
  const match = r.match || {};
  const location = match.line ? `${r.path}:${match.line}` : r.path;
  const name = match.name ? ` ${match.name}` : '';
  return `[${r.tier}] ${location} ${match.type || 'match'}${name} (${r.lines} lines)`;
};

const attachIndex = (result, index) => {
  const isObject = result && typeof result === 'object' && !Array.isArray(result);
  if (isObject) return { ...result, status: result.status || index.status, index };
  return { status: index.status, index, results: result };
};

const formatTextAnswer = (lines, page, index) => {
  const header = [];
  const isInconclusive = index.status === STATUS.INCONCLUSIVE;
  if (isInconclusive) header.push(`INCONCLUSIVE: ${index.reason}`);
  if (page.truncated) header.push(`showing ${page.results.length} of ${page.total} (raise limit for more)`);
  return [...header, ...lines, `# ${formatIndexLine(index)}`].join('\n');
};

export const handleChemxQ = (args = {}, cwd = process.cwd()) => {
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const query = args.query || args.symbol;
  if (!query) throw new Error('chemx_q requires "query" or "symbol" argument.');
  const isLiteral = Boolean(args.literal);
  if (isLiteral) {
    return handleLiteralSearchCommand(null, query, {
      isJson: false, isCli: false, cwd: targetCwd, dir: args.dir || null,
      isRegex: Boolean(args.regex), isCaseInsensitive: Boolean(args.ignoreCase), isLineOnly: Boolean(args.linesOnly),
      isHidden: Boolean(args.hidden), limit: typeof args.limit === 'number' ? args.limit : 50, isQuiet: true
    });
  }
  const { db, index } = syncIndexForQuery(targetCwd, args);

  if (args.blastRadius || args.impact) return attachIndex(executeBlastRadiusQuery(db, query, args), index);
  if (args.semantic) return attachIndex(executeSemanticQuery(db, query, args), index);
  if (args.hybrid) return attachIndex(executeHybridQuery(db, query, args), index);

  if (args.connections || args.symbol) {
    const conn = executeConnectionsQuery(db, query);
    if (conn) return attachIndex(conn, index);
  }

  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const page = queryIndexPage(db, { query, tier: args.tier || null, limit });
  const { results } = page;

  if (args.columnar) {
    const columnar = toColumnar(results, ['path', 'line', 'match', 'name', 'tier', 'lines'], {
      line: (r) => r.match?.line ?? null,
      match: (r) => r.match?.type ?? null,
      name: (r) => r.match?.name ?? null
    });
    return attachIndex({ ...columnar, total: page.total, truncated: page.truncated }, index);
  }

  if (args.inspect) {
    const inspected = results.map((r) => ({
      path: r.path, tier: r.tier, lines: r.lines, match: r.match,
      symbols: (r.symbols || []).map((s) => s.name),
      props: (r.props || []).map((p) => p.name),
      hooks: r.hooks || []
    }));
    return attachIndex({ total: page.total, truncated: page.truncated, results: inspected }, index);
  }

  const lines = results.map(formatTextHit);
  const hasHits = lines.length > 0;
  if (hasHits) return formatTextAnswer(lines, page, index);
  const fts = executeFtsFallback(db, query);
  const fallbackLines = fts ? [fts] : [`No matching capsules or symbols for "${query}" in scope ${index.scope}`];
  return formatTextAnswer(fallbackLines, page, index);
};
