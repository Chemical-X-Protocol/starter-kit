import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractSymbolBlock } from './reader.js';

const _require = createRequire(import.meta.url);
let _parse = null;
let _traverse = null;
const loadBabel = () => {
  if (_parse) return { parse: _parse, traverse: _traverse };
  try {
    _parse = _require('@babel/parser').parse;
    const t = _require('@babel/traverse');
    _traverse = t.default?.default || t.default || t;
  } catch {
    _parse = null;
    _traverse = null;
  }
  return { parse: _parse, traverse: _traverse };
};

const isSpecOrTest = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  return filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('__tests__');
};

export const calculateBlastRadius = (db, targetPathOrSymbol, options = {}) => {
  if (!db || !targetPathOrSymbol) {
    return {
      target: targetPathOrSymbol || '',
      seedPath: '',
      totalImpactCount: 0,
      depth: 0,
      directConsumers: [],
      transitiveConsumers: [],
      impactedTests: [],
      impactedComponents: [],
      tiers: {}
    };
  }

  const cleanTarget = targetPathOrSymbol.trim();
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;

  let seedPath = '';
  let targetSymbolName = cleanTarget;
  const fileRow = db.prepare('SELECT path FROM files WHERE path = ? OR path LIKE ? LIMIT 1')
    .get(cleanTarget, `%${cleanTarget}%`);

  if (fileRow) {
    seedPath = fileRow.path;
  } else {
    const symRow = db.prepare('SELECT file_path, name FROM symbols WHERE name = ? LIMIT 1').get(cleanTarget);
    if (symRow) {
      seedPath = symRow.file_path;
      targetSymbolName = symRow.name;
    }
  }

  const seedBaseName = seedPath ? path.basename(seedPath).replace(/\.[^.]+$/, '') : cleanTarget;

  const querySql = `
    WITH RECURSIVE blast_tree(importer_path, depth, chain) AS (
      SELECT DISTINCT i.importer_path, 1, i.importer_path
      FROM imports i
      WHERE (i.resolved_path = ? AND i.resolved_path != '')
         OR (? != '' AND (i.source_module LIKE '%' || ? || '%' OR i.imported_symbol = ?))

      UNION

      SELECT DISTINCT i.importer_path, bt.depth + 1, bt.chain || ' -> ' || i.importer_path
      FROM imports i
      JOIN blast_tree bt ON (
        (i.resolved_path = bt.importer_path AND i.resolved_path != '')
        OR i.source_module LIKE '%' || bt.importer_path || '%'
      )
      WHERE bt.depth < ?
        AND instr(bt.chain, i.importer_path) = 0
    )
    SELECT bt.importer_path, min(bt.depth) as depth, bt.chain, COALESCE(f.tier, 'utility') as tier
    FROM blast_tree bt
    LEFT JOIN files f ON bt.importer_path = f.path
    WHERE bt.importer_path != ?
    GROUP BY bt.importer_path
    ORDER BY depth ASC, bt.importer_path ASC;
  `;

  const rows = db.prepare(querySql).all(
    seedPath,
    seedBaseName,
    seedBaseName,
    targetSymbolName,
    maxDepth,
    seedPath
  );

  const consumers = rows.map((r) => ({
    path: r.importer_path,
    depth: Number(r.depth),
    chain: r.chain,
    tier: r.tier,
    isTest: isSpecOrTest(r.importer_path)
  }));

  const directConsumers = consumers.filter((c) => c.depth === 1);
  const transitiveConsumers = consumers.filter((c) => c.depth > 1);
  const impactedTests = consumers.filter((c) => c.isTest);
  const impactedComponents = consumers.filter((c) => !c.isTest);

  const tiers = {};
  for (const c of consumers) {
    tiers[c.tier] = (tiers[c.tier] || 0) + 1;
  }

  const maxReachedDepth = consumers.reduce((acc, c) => Math.max(acc, c.depth), 0);

  return {
    target: cleanTarget,
    seedPath,
    totalImpactCount: consumers.length,
    depth: maxReachedDepth,
    directConsumers,
    transitiveConsumers,
    impactedTests,
    impactedComponents,
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
    if (!parse || !traverse) throw new Error('babel unavailable');
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
  } catch {
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
  if (!db || !targetSymbolOrPath) {
    return { target: targetSymbolOrPath || '', totalCallees: 0, depth: 0, callees: [] };
  }

  const cleanTarget = targetSymbolOrPath.trim();
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 3;

  const symRow = db.prepare(`
    SELECT s.name, s.kind, s.start_line, s.end_line, s.file_path, f.tier
    FROM symbols s
    JOIN files f ON s.file_path = f.path
    WHERE s.name = ?
    LIMIT 1
  `).get(cleanTarget);

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
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (fs.existsSync(absPath)) {
      fullText = fs.readFileSync(absPath, 'utf-8');
      const block = extractSymbolBlock(fullText, symbol);
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

      const calleeSym = db.prepare(`
        SELECT s.name, s.kind, s.start_line, s.end_line, s.file_path, f.tier
        FROM symbols s
        JOIN files f ON s.file_path = f.path
        WHERE s.name = ?
        LIMIT 1
      `).get(c);

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
          WHERE (importer_path = ? OR importer_path LIKE ?)
            AND (imported_symbol = ? OR imported_symbol = ? OR imported_symbol = '*')
          LIMIT 1
        `).get(filePath, `%${path.basename(filePath)}%`, c, baseName);

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

  return {
    target: symbolName,
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
 *
 * @param {object} db SQLite index database.
 * @param {string} targetSymbolOrPath Target symbol or file path.
 * @param {object} options Traversal options.
 * @returns {object} Backtrace causal path payload.
 */
export const calculateBacktrace = (db, targetSymbolOrPath, options = {}) => {
  if (!db || !targetSymbolOrPath) {
    return { target: targetSymbolOrPath || '', totalCallers: 0, depth: 0, chains: [], callers: [] };
  }

  const cleanTarget = targetSymbolOrPath.trim();
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;

  let seedPath = '';
  let targetSymbolName = cleanTarget;
  const symRow = db.prepare('SELECT file_path, name FROM symbols WHERE name = ? LIMIT 1').get(cleanTarget);
  if (symRow) {
    seedPath = symRow.file_path;
    targetSymbolName = symRow.name;
  } else {
    const fileRow = db.prepare('SELECT path FROM files WHERE path = ? OR path LIKE ? LIMIT 1').get(cleanTarget, `%${cleanTarget}%`);
    if (fileRow) seedPath = fileRow.path;
  }

  const seedBaseName = seedPath ? path.basename(seedPath).replace(/\.[^.]+$/, '') : cleanTarget;

  const querySql = `
    WITH RECURSIVE backtrace_tree(caller_path, caller_symbol, depth, chain) AS (
      SELECT DISTINCT i.importer_path, i.imported_symbol, 1, i.importer_path || ' (' || i.imported_symbol || ')'
      FROM imports i
      WHERE (? != '' AND i.imported_symbol = ?)
         OR (i.resolved_path = ? AND i.resolved_path != '')
         OR (? != '' AND i.source_module LIKE '%' || ? || '%')

      UNION

      SELECT DISTINCT i.importer_path, i.imported_symbol, bt.depth + 1, i.importer_path || ' -> ' || bt.chain
      FROM imports i
      JOIN backtrace_tree bt ON (
        (i.resolved_path = bt.caller_path AND i.resolved_path != '')
        OR i.source_module LIKE '%' || bt.caller_path || '%'
      )
      WHERE bt.depth < ?
        AND instr(bt.chain, i.importer_path) = 0
    )
    SELECT bt.caller_path, bt.caller_symbol, min(bt.depth) as depth, bt.chain, COALESCE(f.tier, 'utility') as tier
    FROM backtrace_tree bt
    LEFT JOIN files f ON bt.caller_path = f.path
    WHERE bt.caller_path != ?
    GROUP BY bt.caller_path, bt.caller_symbol
    ORDER BY depth DESC, bt.caller_path ASC;
  `;

  const rows = db.prepare(querySql).all(
    targetSymbolName,
    targetSymbolName,
    seedPath,
    seedBaseName,
    seedBaseName,
    maxDepth,
    seedPath
  );

  const callers = rows.map((r) => ({
    path: r.caller_path,
    symbol: r.caller_symbol,
    depth: Number(r.depth),
    chain: r.chain,
    tier: r.tier,
    isEntry: ['view', 'page', 'route', 'template'].includes(r.tier) || isSpecOrTest(r.caller_path)
  }));

  const chains = callers.map((c) => `${c.chain} -> ${cleanTarget}`);
  const maxReachedDepth = callers.reduce((acc, c) => Math.max(acc, c.depth), 0);

  return {
    target: cleanTarget,
    seedPath,
    totalCallers: callers.length,
    depth: maxReachedDepth,
    chains,
    callers,
    rootCallers: callers.filter((c) => c.isEntry || c.depth === maxReachedDepth)
  };
};
