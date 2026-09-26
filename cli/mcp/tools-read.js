import path from 'node:path';
import { openIndexDb } from '../search-db.js';
import {
  findSymbolReferences, findFileDependencies, findFileDependents, calculateBlastRadius,
  calculateCallTrace, calculateBacktrace,
} from '../search-queries.js';
import { findSimilarSymbols } from '../search-queries-similar.js';
import { readTokenOptimized } from '../reader.js';
import { EXT_LANG_MAP, resolveTargetCwd } from './tools-search-util.js';

const buildConnectionCard = (db, symbol, targetPath) => {
  const blast = calculateBlastRadius(db, symbol || targetPath);
  if (symbol) {
    const refs = findSymbolReferences(db, symbol);
    const similar = findSimilarSymbols(db, symbol, 3);
    const simSuffix = similar.length > 0
      ? ` Similar symbols: ${similar.map((s) => `${s.name} (${Math.round(s.similarity * 100)}%)`).join(', ')}.`
      : '';
    return `\n// Connections for ${symbol}: referenced by ${refs.length} file(s) [${refs.slice(0, 3).map((r) => path.basename(r.importerPath)).join(', ')}]. Blast Radius: ${blast.totalImpactCount} affected file(s) across ${blast.depth} hops (${blast.impactedTests.length} tests).${simSuffix}`;
  }
  const deps = findFileDependencies(db, targetPath);
  const dependents = findFileDependents(db, targetPath);
  return `\n// File Connections: imports ${deps.length} symbol(s), imported by ${dependents.length} file(s). Blast Radius: ${blast.totalImpactCount} affected file(s) across ${blast.depth} hops (${blast.impactedTests.length} tests).`;
};

const buildContextEnvelope = (db, targetPath) => {
  try {
    const fileImports = findFileDependencies(db, targetPath);
    if (fileImports.length > 0) {
      const topImports = fileImports.slice(0, 5).map((i) => i.importedSymbol).filter(Boolean);
      if (topImports.length > 0) return `// Context: module imports [${topImports.join(', ')}]\n`;
    }
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[context-envelope] Failed for ${targetPath}: ${err.message}\n`);
  }
  return '';
};

const buildTraceCard = (db, symbol) => {
  try {
    const result = calculateCallTrace(db, symbol, { maxDepth: 3 });
    if (!result || !result.callees || result.callees.length === 0) return '';
    const lines = result.callees.slice(0, 6).map((c) => `//   -> ${c.symbol || c} (${c.file ? path.basename(c.file) : '?'})`);
    return `\n// --- Forward Trace: ${symbol} ---\n${lines.join('\n')}`;
  } catch {
    return '';
  }
};

const buildBacktraceCard = (db, symbol) => {
  try {
    const result = calculateBacktrace(db, symbol, { maxDepth: 5 });
    if (!result || !result.rootCallers || result.rootCallers.length === 0) return '';
    const lines = result.rootCallers.slice(0, 5).map((c) => `//   <- ${path.basename(c)}`);
    return `\n// --- Backtrace: ${symbol} ---\n${lines.join('\n')}`;
  } catch {
    return '';
  }
};

export const handleChemxRead = (args = {}, cwd = process.cwd()) => {
  if (!args.path) throw new Error('chemx_read requires "path" argument.');
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  let rawPath = args.path;
  let startLine = args.startLine;
  let endLine = args.endLine;

  const colonMatch = typeof rawPath === 'string' && rawPath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  if (colonMatch) {
    rawPath = colonMatch[1];
    if (startLine === undefined) startLine = parseInt(colonMatch[2], 10);
    if (endLine === undefined && colonMatch[3]) endLine = parseInt(colonMatch[3], 10);
  }

  const targetPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(targetCwd, rawPath);
  const res = readTokenOptimized(targetPath, {
    outline: args.outline,
    logic: args.logic,
    template: args.template,
    enrich: args.enrich,
    traceSymbol: args.traceSymbol,
    backtraceSymbol: args.backtraceSymbol,
    symbol: args.symbol,
    stripComments: args.stripComments !== false,
    compact: args.compact !== false,
    startLine,
    endLine
  });

  const needsDb = args.connections || args.symbol || (args.enrich && (args.traceSymbol || args.backtraceSymbol));
  const db = needsDb ? openIndexDb(targetCwd) : null;
  const connectionCard = (args.connections && db) ? buildConnectionCard(db, args.symbol, targetPath) : '';
  const contextEnvelope = (args.symbol && db) ? buildContextEnvelope(db, targetPath) : '';

  const traceCard = (args.enrich && args.traceSymbol && db)
    ? buildTraceCard(db, args.traceSymbol)
    : '';
  const backtraceCard = (args.enrich && args.backtraceSymbol && db)
    ? buildBacktraceCard(db, args.backtraceSymbol)
    : '';

  const ext = path.extname(targetPath).toLowerCase();
  const lang = EXT_LANG_MAP[ext] || '';
  const bodyParts = [res.content, res.enriched, traceCard, backtraceCard].filter(Boolean);
  const body = bodyParts.join('\n');
  const fence = body.includes('```') ? '~~~' : '```';
  const fenced = `${fence}${lang}\n${body}\n${fence}`;
  const enrichNote = res.tokensEnriched > 0 ? ` +${res.tokensEnriched} enriched` : '';
  const header = `// ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens${enrichNote})${connectionCard}\n`;
  return header + contextEnvelope + fenced;
};
