import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractSymbolBlock } from './reader.js';
import { debugNote } from './search-debug.js';
import { resolveGraphSeed, walkConsumers, findUnresolvedImporters, findSymbolRow, findCalleeDefinition } from './search-graph-edges.js';
import { moduleKeysFor } from './search-resolve.js';
import { computeImportCoverage } from './sfc/import-coverage.js';

const _require = createRequire(import.meta.url);
let _parse = null;
let _traverse = null;
const loadBabel = () => {
  if (_parse) return { parse: _parse, traverse: _traverse };
  try {
    _parse = _require('@babel/parser').parse;
    const t = _require('@babel/traverse');
    _traverse = t.default?.default || t.default || t;
  } catch (err) {
    _parse = null;
    _traverse = null;
    debugNote.warn('babel unavailable for call trace', err);
  }
  return { parse: _parse, traverse: _traverse };
};

const isSpecOrTest = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  return filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('__tests__');
};

const emptyBlast = (target, extra = {}) => ({
  target, seedPath: '', totalImpactCount: 0, depth: 0, directConsumers: [], transitiveConsumers: [],
  impactedTests: [], impactedComponents: [], possibleConsumers: [], candidates: [], tiers: {}, ...extra
});

// Consumers by exact module resolution only (see search-graph-edges.js). An ambiguous or
// unknown target returns candidates / notFound instead of guessing a seed.
export const calculateBlastRadius = (db, targetPathOrSymbol, options = {}) => {
  const cleanTarget = String(targetPathOrSymbol || '').trim();
  const hasInput = Boolean(db) && cleanTarget.length > 0;
  if (!hasInput) return emptyBlast(cleanTarget, { notFound: true });

  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;
  const seed = resolveGraphSeed(db, cleanTarget);
  const isAmbiguous = seed.candidates.length > 0;
  if (isAmbiguous) return emptyBlast(cleanTarget, { ambiguous: true, candidates: seed.candidates });
  const isNotFound = !seed.seedPath;
  if (isNotFound) return emptyBlast(cleanTarget, { notFound: true });

  const tierOf = db.prepare('SELECT tier FROM files WHERE path = ?');
  const consumers = walkConsumers(db, seed.seedPath, { symbol: seed.symbol, maxDepth }).map((c) => ({
    path: c.path, depth: c.depth, chain: c.chain,
    tier: tierOf.get(c.path)?.tier || 'utility', isTest: isSpecOrTest(c.path)
  }));
  const tiers = {};
  for (const c of consumers) tiers[c.tier] = (tiers[c.tier] || 0) + 1;

  return {
    target: cleanTarget,
    seedPath: seed.seedPath,
    symbol: seed.symbol,
    totalImpactCount: consumers.length,
    coverage: computeImportCoverage(db),
    depth: consumers.reduce((acc, c) => Math.max(acc, c.depth), 0),
    directConsumers: consumers.filter((c) => c.depth === 1),
    transitiveConsumers: consumers.filter((c) => c.depth > 1),
    impactedTests: consumers.filter((c) => c.isTest),
    impactedComponents: consumers.filter((c) => !c.isTest),
    possibleConsumers: findUnresolvedImporters(db, seed.symbol),
    candidates: [],
    tiers
  };
};

/**
 * Extracts called function and method symbols from a code block via AST parsing.
 * Falls back to regex extraction if @babel/parser is unavailable.
 *
 * @param {string} code Source code snippet.
 * @returns {string[]} List of unique called symbol names.
 */
export const extractCalleesFromCode = (code) => {
  const callees = new Set();
  const { parse, traverse } = loadBabel();
  try {
    const hasBabel = Boolean(parse) && Boolean(traverse);
    if (!hasBabel) throw new Error('babel unavailable');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'topLevelAwait'],
      errorRecovery: true,
    });
    traverse(ast, {
      CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (callee.type === 'Identifier') {
          callees.add(callee.name);
        } else if (callee.type === 'MemberExpression') {
          const obj = callee.object?.name || callee.object?.property?.name || '';
          const prop = callee.property?.name || '';
          if (obj && prop) callees.add(`${obj}.${prop}`);
          else if (prop) callees.add(prop);
        }
      },
      OptionalCallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (callee.type === 'Identifier') {
          callees.add(callee.name);
        } else if (callee.type === 'MemberExpression') {
          const obj = callee.object?.name || '';
          const prop = callee.property?.name || '';
          if (obj && prop) callees.add(`${obj}.${prop}`);
          else if (prop) callees.add(prop);
        }
      }
    });
  } catch (err) {
    debugNote.warn('callee extraction fell back to regex', err);
    const matches = code.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g);
    for (const m of matches) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
        callees.add(m[1]);
      }
    }
  }
  return Array.from(callees);
};

/**
 * Calculates forward call trace: downstream functions invoked by target symbol.
 *
 * @param {object} db SQLite index database.
 * @param {string} targetSymbolOrPath Target symbol or file path.
 * @param {object} options Traversal options.
 * @returns {object} Call trace tree payload.
 */
export const calculateCallTrace = (db, targetSymbolOrPath, options = {}) => {
  const hasInput = Boolean(db) && Boolean(targetSymbolOrPath);
  if (!hasInput) {
    return { target: targetSymbolOrPath || '', totalCallees: 0, depth: 0, callees: [] };
  }

  const cleanTarget = targetSymbolOrPath.trim();
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 3;

  const symRow = findSymbolRow(db, cleanTarget, '');

  let targetPath = symRow ? symRow.file_path : cleanTarget;
  let symbolName = symRow ? symRow.name : cleanTarget;
  let startLine = symRow ? Number(symRow.start_line) : 1;
  let endLine = symRow ? Number(symRow.end_line) : 1;
  let tier = symRow ? symRow.tier : 'utility';

  const visited = new Set([symbolName]);

  const traceCallees = (symbol, filePath, currentDepth) => {
    if (currentDepth > maxDepth) return [];

    let codeSlice = '';
    let fullText = '';
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(options.root || process.cwd(), filePath);
    if (fs.existsSync(absPath)) {
      fullText = fs.readFileSync(absPath, 'utf-8');
      const block = extractSymbolBlock(fullText, symbol, absPath);
      if (block) {
        codeSlice = block.code;
      } else {
        const fileLines = fullText.split('\n');
        const start = Math.max(0, startLine - 1);
        const end = Math.min(fileLines.length, endLine > start ? endLine : start + 100);
        codeSlice = fileLines.slice(start, end).join('\n');
      }
    }

    if (!codeSlice) return [];

    const foundCallees = extractCalleesFromCode(codeSlice);
    const results = [];

    for (const c of foundCallees) {
      if (visited.has(c)) continue;
      visited.add(c);

      const calleeSym = findCalleeDefinition(db, c, filePath);

      if (calleeSym) {
        const subCallees = traceCallees(calleeSym.name, calleeSym.file_path, currentDepth + 1);
        results.push({
          symbol: calleeSym.name,
          file: calleeSym.file_path,
          line: Number(calleeSym.start_line),
          tier: calleeSym.tier,
          depth: currentDepth,
          isExternal: false,
          callees: subCallees
        });
      } else {
        const baseName = c.includes('.') ? c.split('.')[0] : c;
        const importRow = db.prepare(`
          SELECT source_module
          FROM imports
          WHERE importer_path = ?
            AND (imported_symbol = ? OR imported_symbol = ? OR imported_symbol = '*')
          ORDER BY line
          LIMIT 1
        `).get(filePath, c, baseName);

        if (importRow) {
          results.push({
            symbol: c,
            file: importRow.source_module,
            line: 1,
            tier: 'external',
            depth: currentDepth,
            isExternal: true,
            callees: []
          });
        } else {
          const isLocal = new RegExp(`(?:const|function|let|var|class)\\s+${baseName}\\b`).test(fullText);
          if (isLocal && baseName !== symbol) {
            const subCallees = traceCallees(baseName, filePath, currentDepth + 1);
            results.push({
              symbol: c,
              file: filePath,
              line: 1,
              tier: 'local',
              depth: currentDepth,
              isExternal: false,
              callees: subCallees
            });
          }
        }
      }
    }

    return results;
  };

  const calleeTree = traceCallees(symbolName, targetPath, 1);
  const totalCount = visited.size - 1;
  const isIndexedFile = !symRow && Boolean(db.prepare('SELECT 1 FROM files WHERE path = ?').get(cleanTarget));
  const isNotFound = !symRow && !isIndexedFile;

  return {
    target: symbolName,
    notFound: isNotFound,
    filePath: targetPath,
    startLine,
    tier,
    totalCallees: totalCount,
    depth: calleeTree.reduce((acc, c) => Math.max(acc, c.depth), 0),
    callees: calleeTree
  };
};

/**
 * Calculates reverse backtrace: upstream callers leading to target symbol.
 * Callers come from the same exact-resolution walk as blast radius; each path appears once.
 *
 * @param {object} db SQLite index database.
 * @param {string} targetSymbolOrPath Target symbol or file path.
 * @param {object} options Traversal options.
 * @returns {object} Backtrace causal path payload.
 */
export const calculateBacktrace = (db, targetSymbolOrPath, options = {}) => {
  const cleanTarget = String(targetSymbolOrPath || '').trim();
  const empty = { target: cleanTarget, seedPath: '', totalCallers: 0, depth: 0, chains: [], callers: [], rootCallers: [], candidates: [] };
  const hasInput = Boolean(db) && cleanTarget.length > 0;
  if (!hasInput) return { ...empty, notFound: true };

  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;
  const seed = resolveGraphSeed(db, cleanTarget);
  const isAmbiguous = seed.candidates.length > 0;
  if (isAmbiguous) return { ...empty, ambiguous: true, candidates: seed.candidates };
  const isNotFound = !seed.seedPath;
  if (isNotFound) return { ...empty, notFound: true };

  const tierOf = db.prepare('SELECT tier FROM files WHERE path = ?');
  const callers = walkConsumers(db, seed.seedPath, { symbol: seed.symbol, maxDepth }).map((c) => {
    const tier = tierOf.get(c.path)?.tier || 'utility';
    const isEntryTier = ['view', 'page', 'route', 'template'].includes(tier);
    return { path: c.path, symbol: c.importedSymbol, depth: c.depth, chain: c.chain, tier, isEntry: isEntryTier || isSpecOrTest(c.path) };
  });
  const consumedPaths = new Set();
  for (const caller of callers) {
    const parent = caller.chain.split(' <- ').slice(-2, -1)[0];
    consumedPaths.add(parent);
  }
  const maxReachedDepth = callers.reduce((acc, c) => Math.max(acc, c.depth), 0);
  const leafCallers = callers.filter((c) => !consumedPaths.has(c.path));
  // A root entry point is a caller nothing in the index imports, whatever its tier.
  const hasImporter = (filePath) => {
    const keys = moduleKeysFor(filePath);
    return Boolean(db.prepare(`SELECT 1 FROM imports WHERE resolved_path IN (${keys.map(() => '?').join(', ')}) LIMIT 1`).get(...keys));
  };
  const rootCallers = callers.filter((c) => !hasImporter(c.path));

  return {
    target: cleanTarget,
    seedPath: seed.seedPath,
    totalCallers: callers.length,
    depth: maxReachedDepth,
    chains: Array.from(new Set(leafCallers.map((c) => c.chain.split(' <- ').reverse().join(' -> ')))),
    callers,
    rootCallers,
    candidates: []
  };
};
