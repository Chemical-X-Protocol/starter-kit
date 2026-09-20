import fs from 'node:fs';
import path from 'node:path';
import { syncSearchIndex } from '../search.js';
import { openIndexDb, queryIndex } from '../search-db.js';
import {
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  calculateBlastRadius,
  querySemanticIndex,
  queryHybridIndex
} from '../search-queries.js';
import { readTokenOptimized } from '../reader.js';
import { patchFile, writeFile } from '../patcher.js';
import { toColumnar } from '../columnar.js';
import { handleCheckCommand } from '../search-commands.js';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export const resolveTargetCwd = (cwd) => {
  const hasCwd = Boolean(cwd);
  const isUserHome = cwd === '/home/xopher';
  const hasPackageJson = hasCwd && fs.existsSync(path.resolve(cwd, 'package.json'));
  const isValidProjectCwd = hasCwd && !isUserHome && hasPackageJson;
  if (!isValidProjectCwd) {
    return PROJECT_ROOT;
  }
  return cwd;
};

export const handleChemxQ = (args = {}, cwd = process.cwd()) => {
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const query = args.query || args.symbol;
  if (!query) {
    throw new Error('chemx_q requires "query" or "symbol" argument.');
  }
  const db = openIndexDb(targetCwd);
  if (!db) {
    syncSearchIndex('src', targetCwd);
  }
  const activeDb = openIndexDb(targetCwd);
  if (!activeDb) {
    throw new Error('Unable to initialize Chemical X AST search index database.');
  }

  const isConnectionLookup = Boolean(args.connections || args.symbol);
  if (args.blastRadius || args.impact) {
    const blast = calculateBlastRadius(activeDb, query, { maxDepth: args.maxDepth || 5 });
    const allConsumers = [...blast.directConsumers, ...blast.transitiveConsumers];
    const colData = toColumnar(allConsumers, ['path', 'tier', 'depth']);
    return {
      target: blast.target,
      seed: blast.seedPath,
      count: blast.totalImpactCount,
      depth: blast.depth,
      tiers: blast.tiers,
      format: 'columnar',
      cols: colData.cols,
      rows: colData.rows,
      tests: blast.impactedTests.map((t) => t.path || t)
    };
  }

  if (args.semantic) {
    const results = querySemanticIndex(activeDb, query, { limit: args.limit || 20, tier: args.tier });
    const colData = toColumnar(results, ['filePath', 'targetType', 'targetName', 'tier', 'similarity']);
    return {
      query,
      mode: 'semantic',
      count: results.length,
      format: 'columnar',
      cols: colData.cols,
      rows: colData.rows
    };
  }

  if (args.hybrid) {
    const results = queryHybridIndex(activeDb, query, { limit: args.limit || 20 });
    const colData = toColumnar(results, ['filePath', 'name', 'tier', 'score', 'ftsRank', 'vecRank']);
    return {
      query,
      mode: 'hybrid (BM25 + Vector RRF)',
      count: results.length,
      format: 'columnar',
      cols: colData.cols,
      rows: colData.rows
    };
  }

  if (isConnectionLookup) {
    const symDef = findSymbolDefinition(activeDb, query);
    const symRefs = findSymbolReferences(activeDb, query);
    if (symDef) {
      const deps = findFileDependencies(activeDb, symDef.filePath);
      const blast = calculateBlastRadius(activeDb, symDef.name);
      return {
        symbol: symDef.name,
        kind: symDef.kind,
        filePath: symDef.filePath,
        lines: `${symDef.startLine}-${symDef.endLine}`,
        signature: symDef.signature,
        dependencies: deps.map((d) => `${d.sourceModule}: ${d.importedSymbol}`),
        consumers: symRefs.map((r) => `${r.importerPath}:${r.line}`),
        blastRadius: {
          totalImpactCount: blast.totalImpactCount,
          impactedTests: blast.impactedTests.map((t) => t.path)
        }
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
        blastRadius: {
          totalImpactCount: blast.totalImpactCount,
          impactedTests: blast.impactedTests.map((t) => t.path)
        }
      };
    }
  }

  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const results = queryIndex(activeDb, {
    query,
    tier: args.tier || 'all',
    limit
  });

  if (args.columnar) {
    return toColumnar(results, ['path', 'tier', 'lines', 'symbols', 'props', 'hooks'], {
      symbols: (r) => (r.symbols || []).map((s) => s.name),
      props: (r) => (r.props || []).map((p) => p.name),
      hooks: (r) => r.hooks || []
    });
  }

  if (args.inspect) {
    return results.map((r) => ({
      path: r.path,
      tier: r.tier,
      lines: r.lines,
      symbols: (r.symbols || []).map((s) => s.name),
      props: (r.props || []).map((p) => p.name),
      hooks: r.hooks || []
    }));
  }

  const lines = results.map((r) => {
    const mainSym = (r.symbols || []).find((s) => s.isExport)?.name || '';
    const symPart = mainSym ? ` (${mainSym})` : '';
    const hasHooks = Boolean(r.hooks && r.hooks.length > 0);
    const hookPart = hasHooks ? ` [${r.hooks.slice(0, 2).join(',')}]` : '';
    return `[${r.tier.toUpperCase()}] ${r.path}:${r.lines}L${symPart}${hookPart}`;
  });

  const hasLines = lines.length > 0;
  return hasLines ? lines.join('\n') : `No matching capsules or symbols for "${query}"`;
};

export const handleChemxRead = (args = {}, cwd = process.cwd()) => {
  if (!args.path) {
    throw new Error('chemx_read requires "path" argument.');
  }
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(targetCwd, args.path);
  const res = readTokenOptimized(targetPath, {
    outline: args.outline,
    symbol: args.symbol,
    stripComments: args.stripComments !== false,
    compact: args.compact !== false,
    startLine: args.startLine,
    endLine: args.endLine
  });

  let connectionCard = '';
  if (args.connections) {
    const db = openIndexDb(targetCwd);
    if (db) {
      const blast = calculateBlastRadius(db, args.symbol || targetPath);
      if (args.symbol) {
        const refs = findSymbolReferences(db, args.symbol);
        connectionCard = `\n// Connections for ${args.symbol}: referenced by ${refs.length} file(s) [${refs.slice(0, 3).map((r) => path.basename(r.importerPath)).join(', ')}]. Blast Radius: ${blast.totalImpactCount} affected file(s) across ${blast.depth} hops (${blast.impactedTests.length} tests).`;
      } else {
        const deps = findFileDependencies(db, targetPath);
        const dependents = findFileDependents(db, targetPath);
        connectionCard = `\n// File Connections: imports ${deps.length} symbol(s), imported by ${dependents.length} file(s). Blast Radius: ${blast.totalImpactCount} affected file(s) across ${blast.depth} hops (${blast.impactedTests.length} tests).`;
      }
    }
  }

  const header = `// ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens)${connectionCard}\n`;
  return header + res.content;
};

const isSevereViolation = (v) => {
  const isCritical = v.severity === 'CRITICAL';
  const isHigh = v.severity === 'HIGH';
  return isCritical || isHigh;
};

const formatPatchWarnings = (result) => {
  const warnings = [];

  // Stage 1: Atomic Concept Declarations
  const hasLineBudget = Boolean(result.lineBudget);
  const isBudgetExceeded = hasLineBudget && !result.lineBudget.passed;

  // Stage 2: Clean Conditionals
  if (isBudgetExceeded) {
    warnings.push(`[Directive 1.A] ${result.lineBudget.warning}`);
  }

  const violations = result.violations || [];
  for (const v of violations) {
    const isSevere = isSevereViolation(v);
    if (isSevere) {
      warnings.push(`[${v.severity} - ${v.rule}] Line ${v.line}: ${v.hazard} -> ${v.directive || ''}`);
    }
  }

  const hasWarnings = warnings.length > 0;
  return hasWarnings ? warnings : undefined;
};

export const handleChemxPatch = (args = {}, cwd = process.cwd()) => {
  // Stage 1: Atomic Concept Declarations
  const hasPath = Boolean(args.path);
  const hasTargetContent = args.targetContent !== undefined;
  const hasReplacementContent = args.replacementContent !== undefined;

  // Stage 2: Unified Decision Variable
  const hasRequiredArgs = hasPath && hasTargetContent && hasReplacementContent;

  // Stage 3: Early-Return Guard Clause
  if (!hasRequiredArgs) {
    throw new Error('chemx_patch requires "path", "targetContent", and "replacementContent" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = patchFile(targetPath, {
    targetContent: args.targetContent,
    replacementContent: args.replacementContent,
    allowMultiple: Boolean(args.allowMultiple),
    cwd
  });

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};

export const handleChemxCheck = (args = {}, cwd = process.cwd()) => {
  if (args.path === 'RESTART_MCP') {
    setTimeout(() => process.exit(0), 50);
    return { restarting: true };
  }
  if (!args.path) {
    throw new Error('chemx_check requires "path" argument.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  return handleCheckCommand(targetPath, { isJson: true, isCli: false });
};

export const handleChemxWrite = (args = {}, cwd = process.cwd()) => {
  // Stage 1: Atomic Concept Declarations
  const hasPath = Boolean(args.path);
  const hasContent = args.content !== undefined;

  // Stage 2: Unified Decision Variable
  const hasRequiredArgs = hasPath && hasContent;

  // Stage 3: Early-Return Guard Clause
  if (!hasRequiredArgs) {
    throw new Error('chemx_write requires "path" and "content" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = writeFile(targetPath, {
    content: args.content,
    cwd
  });

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};
