import { queryIndexPage, calculateCallTrace, calculateBacktrace } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import { formatIndexLine } from '../search-output.js';
import { openSyncedIndex } from '../search-session.js';
import { handleLiteralSearchCommand } from '../search-commands-literal.js';
import { STATUS, combineStatuses } from '../result-status.js';
import { resolveTargetCwd } from './tools-search-util.js';
import {
  executeBlastRadiusQuery, executeSemanticQuery,
  executeHybridQuery, executeConnectionsQuery, executeFtsFallback
} from './tools-q-modes.js';

// Every MCP q call runs the mtime sync first (a stat per file), so files created, edited or
// deleted outside chemx (Edit tool, git checkout, editors) are never answered from old rows.
const GRAPH_ARGS = ['blastRadius', 'impact', 'semantic', 'trace', 'backtrace', 'hybrid', 'connections', 'symbol'];

export const syncIndexForQuery = (targetCwd, args = {}) => {
  const includeHeldScopes = GRAPH_ARGS.some((key) => Boolean(args[key]));
  const session = openSyncedIndex(targetCwd, args.dir, { includeHeldScopes, reindex: Boolean(args.reindex) });
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

// A trace or backtrace payload carries notFound/ambiguous flags instead of a status.
const resolvePayloadStatus = (result) => {
  const hasOwnStatus = Boolean(result.status);
  if (hasOwnStatus) return result.status;
  const isUnresolved = Boolean(result.notFound || result.ambiguous);
  return isUnresolved ? STATUS.INCONCLUSIVE : STATUS.PASS;
};

// Worst status wins: a graph payload's own 'pass' never hides an inconclusive index.
const attachIndex = (result, index) => {
  const isObject = result && typeof result === 'object' && !Array.isArray(result);
  if (isObject) return { ...result, status: combineStatuses([resolvePayloadStatus(result), index.status]), index };
  return { status: index.status, index, results: result };
};

const formatTextAnswer = (lines, page, index) => {
  const header = [];
  const isInconclusive = index.status === STATUS.INCONCLUSIVE;
  if (isInconclusive) header.push(`INCONCLUSIVE: ${index.reason}`);
  const isTruncated = Boolean(page.truncated);
  if (isTruncated) header.push(`showing ${page.results.length} of ${page.total} (raise limit for more)`);
  return [...header, ...lines, `# ${formatIndexLine(index)}`].join('\n');
};

export const handleChemxQ = (args = {}, cwd = process.cwd()) => {
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const query = args.query || args.symbol;
  if (!query) throw new Error('chemx_q requires "query" or "symbol" argument.');
  const isLiteral = Boolean(args.literal);
  if (isLiteral) {
    const isBare = args.bare !== false && !args.json;
    const context = typeof args.context === 'number' ? args.context : 0;
    const beforeContext = typeof args.beforeContext === 'number' ? args.beforeContext : context;
    const afterContext = typeof args.afterContext === 'number' ? args.afterContext : context;
    const res = handleLiteralSearchCommand(null, query, {
      isJson: false, isCli: false, cwd: targetCwd, dir: args.paths || args.path || args.dir || null,
      isRegex: Boolean(args.regex), isCaseInsensitive: Boolean(args.ignoreCase), isLineOnly: Boolean(args.lines || args.linesOnly),
      isHidden: Boolean(args.hidden), limit: typeof args.limit === 'number' ? args.limit : 50, isQuiet: true,
      isBare, context, beforeContext, afterContext
    });
    const isJson = Boolean(args.json);
    if (isJson) return res;
    const hasNoMatches = res.matches.length === 0;
    if (hasNoMatches) return `no matches for "${query}"`;
    const lines = [];
    let lastPath = null;
    let lastLine = null;
    for (let i = 0; i < res.matches.length; i++) {
      const m = res.matches[i];
      const hasBeforeContext = Boolean(m.before && m.before.length > 0);
      const hasAfterContext = Boolean(m.after && m.after.length > 0);
      const hasCtx = hasBeforeContext || hasAfterContext;
      const isSubsequentMatch = i > 0;
      const shouldCheckSeparator = hasCtx && isSubsequentMatch;
      if (shouldCheckSeparator) {
        const isDifferentPath = lastPath !== m.path;
        const firstLine = m.before?.[0]?.line ?? m.line;
        const isLineGap = firstLine > (lastLine + 1);
        const isNonContiguous = isDifferentPath || isLineGap;
        if (isNonContiguous) lines.push('--');
      }
      if (hasBeforeContext) {
        for (const b of m.before) lines.push(`${m.path}-${b.line}-${b.text}`);
      }
      lines.push(`${m.path}:${m.line}:${m.text}`);
      if (hasAfterContext) {
        for (const a of m.after) lines.push(`${m.path}-${a.line}-${a.text}`);
      }
      lastPath = m.path;
      lastLine = m.after?.[m.after.length - 1]?.line ?? m.line;
    }
    return lines.join('\n');
  }
  const session = syncIndexForQuery(targetCwd, args);
  const { db, index } = session;

  const isBlastRadiusQuery = Boolean(args.blastRadius || args.impact);
  if (isBlastRadiusQuery) return attachIndex(executeBlastRadiusQuery(db, query, args), index);
  const isSemanticQuery = Boolean(args.semantic);
  if (isSemanticQuery) return attachIndex(executeSemanticQuery(db, query, args), index);
  const isTraceQuery = Boolean(args.trace);
  if (isTraceQuery) return attachIndex(calculateCallTrace(db, query, { maxDepth: args.maxDepth || 3, root: session.root }), index);
  const isBacktraceQuery = Boolean(args.backtrace);
  if (isBacktraceQuery) return attachIndex(calculateBacktrace(db, query, { maxDepth: args.maxDepth || 5 }), index);
  const isHybridQuery = Boolean(args.hybrid);
  if (isHybridQuery) return attachIndex(executeHybridQuery(db, query, args), index);

  const wantsConnections = Boolean(args.connections || args.symbol);
  if (wantsConnections) {
    const conn = executeConnectionsQuery(db, query);
    if (conn) return attachIndex(conn, index);
  }

  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const page = queryIndexPage(db, { query, tier: args.tier || null, limit, scopeDirs: index.scopeDirs });
  const { results } = page;

  const isColumnar = Boolean(args.columnar);
  if (isColumnar) {
    const columnar = toColumnar(results, ['path', 'line', 'match', 'name', 'tier', 'lines'], {
      line: (r) => r.match?.line ?? null,
      match: (r) => r.match?.type ?? null,
      name: (r) => r.match?.name ?? null
    });
    return attachIndex({ ...columnar, total: page.total, truncated: page.truncated }, index);
  }

  const isInspect = Boolean(args.inspect);
  if (isInspect) {
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
  const fts = executeFtsFallback(db, query, index.scopeDirs);
  const fallbackLines = fts ? [fts] : [`No matching capsules or symbols for "${query}" in scope ${index.scope}`];
  return formatTextAnswer(fallbackLines, page, index);
};
