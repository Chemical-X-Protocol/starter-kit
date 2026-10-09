import {
  findSymbolDefinition, findSymbolReferences, findFileDependencies,
  findFileDependents, calculateBlastRadius, querySemanticIndex, queryHybridIndex
} from '../search-queries.js';
import { toColumnar } from '../columnar.js';
import { buildBlastPayload } from '../search-commands-blast.js';
import { isPathInScope } from '../search-root.js';

export const executeBlastRadiusQuery = (activeDb, query, args = {}) => {
  const blast = calculateBlastRadius(activeDb, query, { maxDepth: args.maxDepth || 5 });
  return buildBlastPayload(blast, { isColumnar: true });
};

export const executeSemanticQuery = (activeDb, query, args = {}) => {
  const results = querySemanticIndex(activeDb, query, { limit: args.limit || 20, tier: args.tier });
  const col = toColumnar(results, ['filePath', 'targetType', 'targetName', 'tier', 'similarity']);
  return { query, mode: 'feature-hash similarity', model: 'feature-hash-128 (not a learned embedding)', count: results.length, format: 'columnar', cols: col.cols, rows: col.rows };
};

export const executeHybridQuery = (activeDb, query, args = {}) => {
  const results = queryHybridIndex(activeDb, query, { limit: args.limit || 20 });
  const col = toColumnar(results, ['filePath', 'name', 'tier', 'score', 'ftsRank', 'vecRank']);
  return { query, mode: 'hybrid (BM25 + feature-hash RRF)', model: 'feature-hash-128 (not a learned embedding)', count: results.length, format: 'columnar', cols: col.cols, rows: col.rows };
};

export const executeConnectionsQuery = (activeDb, query) => {
  const symDef = findSymbolDefinition(activeDb, query);
  if (symDef) {
    const deps = findFileDependencies(activeDb, symDef.filePath);
    const symRefs = findSymbolReferences(activeDb, query);
    const blast = calculateBlastRadius(activeDb, symDef.name);
    return {
      symbol: symDef.name, kind: symDef.kind, filePath: symDef.filePath,
      lines: `${symDef.startLine}-${symDef.endLine}`, signature: symDef.signature,
      dependencies: deps.map((d) => `${d.sourceModule}: ${d.importedSymbol}`),
      consumers: symRefs.map((r) => `${r.importerPath}:${r.line}`),
      blastRadius: { totalImpactCount: blast.totalImpactCount, impactedTests: blast.impactedTests.map((t) => t.path) }
    };
  }
  const deps = findFileDependencies(activeDb, query);
  const dependents = findFileDependents(activeDb, query);
  const hasFileConnections = deps.length > 0 || dependents.length > 0;
  if (hasFileConnections) {
    const blast = calculateBlastRadius(activeDb, query);
    return {
      file: query,
      dependencies: deps.map((d) => `${d.sourceModule}: ${d.importedSymbol}`),
      dependents: dependents.map((d) => `${d.importerPath}:${d.line}`),
      blastRadius: { totalImpactCount: blast.totalImpactCount, impactedTests: blast.impactedTests.map((t) => t.path) }
    };
  }
  return null;
};

export const executeFtsFallback = (activeDb, query, scopeDirs = null) => {
  const isScoped = Array.isArray(scopeDirs) && scopeDirs.length > 0;
  try {
    const clean = query.replace(/[^\w\s-]/g, ' ').trim();
    if (clean) {
      const rows = activeDb.prepare('SELECT file_path, name, tier FROM fts_index WHERE fts_index MATCH ?').all(`"${clean}"*`)
        .filter((r) => !isScoped || isPathInScope(r.file_path, scopeDirs)).slice(0, 10);
      const hasFtsRows = rows.length > 0;
      if (hasFtsRows) return rows.map((r) => `[FTS MATCH] ${r.file_path} (${r.name || r.tier})`).join('\n');
    }
  } catch (err) {
    const isDebugEnabled = Boolean(process.env.CHEMX_DEBUG);
    if (isDebugEnabled) process.stderr.write(`[fts-fallback] Search failed for ${query}: ${err.message}\n`);
  }
  return null;
};
