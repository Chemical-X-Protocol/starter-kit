import path from 'node:path';
import { openIndexDb } from '../search-db.js';
import {
  findSymbolReferences, findFileDependencies, findFileDependents, calculateBlastRadius
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
    outline: args.outline, symbol: args.symbol,
    stripComments: args.stripComments !== false, compact: args.compact !== false,
    startLine, endLine
  });

  const db = (args.connections || args.symbol) ? openIndexDb(targetCwd) : null;
  const connectionCard = (args.connections && db) ? buildConnectionCard(db, args.symbol, targetPath) : '';
  const contextEnvelope = (args.symbol && db) ? buildContextEnvelope(db, targetPath) : '';

  const ext = path.extname(targetPath).toLowerCase();
  const lang = EXT_LANG_MAP[ext] || '';
  const fence = res.content.includes('```') ? '~~~' : '```';
  const fenced = `${fence}${lang}\n${res.content}\n${fence}`;
  const header = `// ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens)${connectionCard}\n`;
  return header + contextEnvelope + fenced;
};
