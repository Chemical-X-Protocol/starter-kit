import {
  findSymbolDefinition, findSymbolReferences, findFileDependencies,
  findFileDependents, calculateBlastRadius, querySemanticIndex, queryHybridIndex
} from '../search-queries.js';
import { toColumnar } from '../columnar.js';

export const executeBlastRadiusQuery = (activeDb, query, args = {}) => {
  const blast = calculateBlastRadius(activeDb, query, { maxDepth: args.maxDepth || 5 });
  const allConsumers = [...blast.directConsumers, ...blast.transitiveConsumers];
  const col = toColumnar(allConsumers, ['path', 'tier', 'depth']);
  return {
    target: blast.target, seed: blast.seedPath, count: blast.totalImpactCount,
    depth: blast.depth, tiers: blast.tiers, format: 'columnar',
    cols: col.cols, rows: col.rows, tests: blast.impactedTests.map((t) => t.path || t)
  };
};

export const executeSemanticQuery = (activeDb, query, args = {}) => {
  const results = querySemanticIndex(activeDb, query, { limit: args.limit || 20, tier: args.tier });
  const col = toColumnar(results, ['filePath', 'targetType', 'targetName', 'tier', 'similarity']);
  return { query, mode: 'semantic', count: results.length, format: 'columnar', cols: col.cols, rows: col.rows };
};

export const executeHybridQuery = (activeDb, query, args = {}) => {
  const results = queryHybridIndex(activeDb, query, { limit: args.limit || 20 });
  const col = toColumnar(results, ['filePath', 'name', 'tier', 'score', 'ftsRank', 'vecRank']);
  return { query, mode: 'hybrid (BM25 + Vector RRF)', count: results.length, format: 'columnar', cols: col.cols, rows: col.rows };
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
  if (deps.length > 0 || dependents.length > 0) {
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

export const executeFtsFallback = (activeDb, query) => {
  try {
    const clean = query.replace(/[^\w\s-]/g, ' ').trim();
    if (clean) {
      const rows = activeDb.prepare('SELECT file_path, name, tier FROM fts_index WHERE fts_index MATCH ? LIMIT 10').all(`"${clean}"*`);
      if (rows.length > 0) return rows.map((r) => `[FTS MATCH] ${r.file_path} (${r.name || r.tier})`).join('\n');
    }
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[fts-fallback] Search failed for ${query}: ${err.message}\n`);
  }
  return null;
};
