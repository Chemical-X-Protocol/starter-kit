/**
 * Index-backed cards appended to reads: connections, context envelope, forward trace and
 * backtrace. Shared by the CLI reader and the MCP read tool so both honor the same flags.
 */
import path from 'node:path';
import { openIndexDb } from './search-db.js';
import {
  findSymbolReferences, findFileDependencies, findFileDependents, calculateBlastRadius,
  calculateCallTrace, calculateBacktrace,
} from './search-queries.js';
import { findSimilarSymbols } from './search-queries-similar.js';

export const buildConnectionCard = (db, symbol, targetPath) => {
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

export const buildContextEnvelope = (db, targetPath) => {
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

export const buildTraceCard = (db, symbol) => {
  try {
    const result = calculateCallTrace(db, symbol, { maxDepth: 3 });
    const hasCallees = Boolean(result?.callees?.length);
    if (!hasCallees) return '';
    const lines = result.callees.slice(0, 6).map((c) => `//   -> ${c.symbol || c} (${c.file ? path.basename(c.file) : '?'})`);
    return `\n// --- Forward Trace: ${symbol} ---\n${lines.join('\n')}`;
  } catch {
    return '';
  }
};

export const buildBacktraceCard = (db, symbol) => {
  try {
    const result = calculateBacktrace(db, symbol, { maxDepth: 5 });
    const hasCallers = Boolean(result?.rootCallers?.length);
    if (!hasCallers) return '';
    const lines = result.rootCallers.slice(0, 5).map((c) => `//   <- ${path.basename(c)}`);
    return `\n// --- Backtrace: ${symbol} ---\n${lines.join('\n')}`;
  } catch {
    return '';
  }
};

const openCardsDb = (cwd) => {
  try {
    return openIndexDb(cwd);
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[read-cards] index unavailable: ${err.message}\n`);
    return null;
  }
};

/**
 * Builds every requested card for one read.
 *
 * @param {string} cwd Project root (index location).
 * @param {string} targetPath Absolute file path.
 * @param {object} flags { symbol, connections, traceSymbol, backtraceSymbol, context }
 * @returns {{ connection: string, context: string, trace: string, backtrace: string }}
 */
export const buildReadCards = (cwd, targetPath, flags = {}) => {
  const empty = { connection: '', context: '', trace: '', backtrace: '' };
  const wantsContext = Boolean(flags.context && flags.symbol);
  const needsDb = Boolean(flags.connections || wantsContext || flags.traceSymbol || flags.backtraceSymbol);
  if (!needsDb) return empty;
  const db = openCardsDb(cwd);
  if (!db) return empty;
  return {
    connection: flags.connections ? buildConnectionCard(db, flags.symbol, targetPath) : '',
    context: wantsContext ? buildContextEnvelope(db, targetPath) : '',
    trace: flags.traceSymbol ? buildTraceCard(db, flags.traceSymbol) : '',
    backtrace: flags.backtraceSymbol ? buildBacktraceCard(db, flags.backtraceSymbol) : ''
  };
};
