/**
 * Index-backed cards appended to reads: connections, context envelope, forward trace and
 * backtrace. Shared by the CLI reader and the MCP read tool so both honor the same flags.
 */
import fs from 'node:fs';
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
    const topImports = fileImports.slice(0, 5).map((i) => i.importedSymbol).filter(Boolean);
    const hasImports = topImports.length > 0;
    if (hasImports) return `// Context: module imports [${topImports.join(', ')}]\n`;
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[context-envelope] Failed for ${targetPath}: ${err.message}\n`);
  }
  return '';
};

const errorText = (err) => (err instanceof Error ? err.message : String(err));

export const buildTraceCard = (db, symbol) => {
  try {
    const result = calculateCallTrace(db, symbol, { maxDepth: 3 });
    const callees = result?.callees || [];
    const lines = callees.slice(0, 6).map((c) => `//   -> ${c.symbol || c} (${c.file ? path.basename(c.file) : '?'})`);
    const isEmpty = lines.length === 0;
    if (isEmpty) lines.push('//   (no callees found in the index)');
    return `\n// --- Forward Trace: ${symbol} ---\n${lines.join('\n')}`;
  } catch (err) {
    return `\n// --- Forward Trace: ${symbol} --- failed: ${errorText(err)}`;
  }
};

const describeCaller = (c) => {
  const isObject = c !== null && typeof c === 'object';
  if (!isObject) return String(c);
  const via = c.symbol ? ` via ${c.symbol}` : '';
  return `${c.path}${via} (depth ${c.depth})`;
};

export const buildBacktraceCard = (db, symbol) => {
  try {
    const result = calculateBacktrace(db, symbol, { maxDepth: 5 });
    const roots = result?.rootCallers || [];
    const lines = roots.slice(0, 5).map((c) => `//   <- ${describeCaller(c)}`);
    const isEmpty = lines.length === 0;
    if (isEmpty) lines.push('//   (no callers found in the index)');
    return `\n// --- Backtrace: ${symbol} (${result?.totalCallers || 0} caller(s)) ---\n${lines.join('\n')}`;
  } catch (err) {
    return `\n// --- Backtrace: ${symbol} --- failed: ${errorText(err)}`;
  }
};

const NO_INDEX_HINT = 'no search index at .chemx/index.db; run `cx q <symbol>` once to build it, then re-read';

const hasBuiltIndex = (cwd) => {
  const dbFile = path.join(cwd, '.chemx', 'index.db');
  return fs.existsSync(dbFile);
};

const isIndexEmpty = (db) => {
  try {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n || 0) === 0;
  } catch {
    return true;
  }
};

const unavailableCards = (flags) => ({
  connection: flags.connections ? `\n// Connections unavailable: ${NO_INDEX_HINT}.` : '',
  context: '',
  trace: flags.traceSymbol ? `\n// Forward Trace unavailable: ${NO_INDEX_HINT}.` : '',
  backtrace: flags.backtraceSymbol ? `\n// Backtrace unavailable: ${NO_INDEX_HINT}.` : ''
});

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
  const isIndexMissing = !hasBuiltIndex(cwd);
  if (isIndexMissing) return unavailableCards(flags);
  const db = openCardsDb(cwd);
  const isUnusable = !db || isIndexEmpty(db);
  if (isUnusable) return unavailableCards(flags);
  return {
    connection: flags.connections ? buildConnectionCard(db, flags.symbol, targetPath) : '',
    context: wantsContext ? buildContextEnvelope(db, targetPath) : '',
    trace: flags.traceSymbol ? buildTraceCard(db, flags.traceSymbol) : '',
    backtrace: flags.backtraceSymbol ? buildBacktraceCard(db, flags.backtraceSymbol) : ''
  };
};
