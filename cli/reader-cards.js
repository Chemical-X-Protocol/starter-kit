/**
 * Index-backed cards appended to reads: connections, context envelope, forward trace and
 * backtrace. Shared by the CLI reader and the MCP read tool so both honor the same flags.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureFresh } from './index-freshness.js';
import { chemxDbPathFor } from './sqlite-memory.js';
import { formatIndexLine } from './search-output.js';
import { toRootRelative } from './search-root.js';
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
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[context-envelope] Failed for ${targetPath}: ${err.message}\n`);
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

// A read never creates .chemx in a project that has none (a read is not an opt-in to chemx).
// With .chemx present, a missing or stale index is built or synced before the cards answer.
const NO_HOME_HINT = 'no search index: this project has no .chemx yet; run `chemx q <symbol>` once to create it, then re-read';

const hasIndexHome = (cwd) => {
  const dbFile = chemxDbPathFor(cwd);
  const hasPath = Boolean(dbFile);
  return hasPath && fs.existsSync(path.dirname(dbFile));
};

const isIndexEmpty = (db) => {
  try {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n || 0) === 0;
  } catch {
    return true;
  }
};

const unavailableCards = (flags, why, freshness = '') => ({
  connection: flags.connections ? `\n// Connections unavailable: ${why}.` : '',
  context: '',
  trace: flags.traceSymbol ? `\n// Forward Trace unavailable: ${why}.` : '',
  backtrace: flags.backtraceSymbol ? `\n// Backtrace unavailable: ${why}.` : '',
  freshness
});

// Graph cards read other files' rows (dependents, callers, callees), so they sync the project
// scope and every held scope; the context card reads only the target's own imports.
const syncForCards = (cwd, targetPath, flags) => {
  const needsGraph = Boolean(flags.connections || flags.traceSymbol || flags.backtraceSymbol);
  try {
    return ensureFresh(cwd, { paths: [targetPath], scope: needsGraph ? null : false, includeHeldScopes: needsGraph });
  } catch (err) {
    return { db: null, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Builds every requested card for one read.
 *
 * @param {string} cwd Project root (index location).
 * @param {string} targetPath Absolute file path.
 * @param {object} flags { symbol, connections, traceSymbol, backtraceSymbol, context }
 * @returns {{ connection: string, context: string, trace: string, backtrace: string, freshness: string }}
 *   freshness is the index line of the sync these cards answered from (index-freshness.js).
 */
export const buildReadCards = (cwd, targetPath, flags = {}) => {
  const empty = { connection: '', context: '', trace: '', backtrace: '', freshness: '' };
  const wantsContext = Boolean(flags.context && flags.symbol);
  const needsDb = Boolean(flags.connections || wantsContext || flags.traceSymbol || flags.backtraceSymbol);
  if (!needsDb) return empty;
  const isHomeMissing = !hasIndexHome(cwd);
  if (isHomeMissing) return unavailableCards(flags, NO_HOME_HINT);
  const session = syncForCards(cwd, targetPath, flags);
  const db = session.db;
  const freshness = session.index ? `\n// ${formatIndexLine(session.index)}` : '';
  const hasNoDb = !db;
  if (hasNoDb) return unavailableCards(flags, `index unavailable (${session.error || 'SQLite engine not available'})`);
  const isEmpty = isIndexEmpty(db);
  if (isEmpty) return unavailableCards(flags, 'the index holds no source files for this project', freshness);
  // Rows are keyed by root-relative posix paths, never by the absolute path the reader holds.
  const relPath = toRootRelative(targetPath, session.root);
  return {
    freshness,
    connection: flags.connections ? buildConnectionCard(db, flags.symbol, relPath) : '',
    context: wantsContext ? buildContextEnvelope(db, relPath) : '',
    trace: flags.traceSymbol ? buildTraceCard(db, flags.traceSymbol) : '',
    backtrace: flags.backtraceSymbol ? buildBacktraceCard(db, flags.backtraceSymbol) : ''
  };
};
