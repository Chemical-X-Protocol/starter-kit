// Import-graph edges by exact module resolution. A consumer of file F is a row whose
// resolved_path is one of F's module keys (F, F without extension, its dir for index files).
// No basename substring matching: './config/index.js' never matches a target 'store/index.ts'.
import { moduleKeysFor } from './search-resolve.js';

const toCandidateList = (rows) => Array.from(new Set(rows.map((r) => r.path || r.file_path))).sort();

// Returns { seedPath, symbol, candidates }: a unique seed, or the candidates when ambiguous.
export const resolveGraphSeed = (db, rawTarget) => {
  const target = String(rawTarget || '').trim().replace(/^\.\//, '');
  const exact = db.prepare('SELECT path FROM files WHERE path = ?').get(target);
  if (exact) return { seedPath: exact.path, symbol: null, candidates: [] };

  const suffixRows = db.prepare('SELECT path FROM files WHERE path LIKE ? ORDER BY path').all(`%/${target}`);
  const suffixMatches = toCandidateList(suffixRows);
  const isUniqueSuffix = suffixMatches.length === 1;
  if (isUniqueSuffix) return { seedPath: suffixMatches[0], symbol: null, candidates: [] };
  const isAmbiguousSuffix = suffixMatches.length > 1;
  if (isAmbiguousSuffix) return { seedPath: '', symbol: null, candidates: suffixMatches };

  const defRows = db.prepare('SELECT file_path, is_export FROM symbols WHERE name = ? ORDER BY is_export DESC, file_path').all(target);
  const exportedDefs = toCandidateList(defRows.filter((r) => Number(r.is_export) === 1));
  const allDefs = toCandidateList(defRows);
  const defFiles = exportedDefs.length > 0 ? exportedDefs : allDefs;
  const isUniqueDef = defFiles.length === 1;
  if (isUniqueDef) return { seedPath: defFiles[0], symbol: target, candidates: [] };
  const isAmbiguousDef = defFiles.length > 1;
  if (isAmbiguousDef) return { seedPath: '', symbol: target, candidates: defFiles };

  const containsRows = db.prepare('SELECT path FROM files WHERE path LIKE ? ORDER BY path').all(`%${target}%`);
  const containsMatches = toCandidateList(containsRows);
  const isUniqueContains = containsMatches.length === 1;
  if (isUniqueContains) return { seedPath: containsMatches[0], symbol: null, candidates: [] };
  return { seedPath: '', symbol: null, candidates: containsMatches };
};

const importersOf = (db, filePath, symbol) => {
  const keys = moduleKeysFor(filePath);
  const placeholders = keys.map(() => '?').join(', ');
  const hasSymbolFilter = Boolean(symbol);
  const symbolClause = hasSymbolFilter ? " AND imported_symbol IN (?, '*', 'default')" : '';
  const params = hasSymbolFilter ? [...keys, symbol] : keys;
  return db.prepare(`SELECT importer_path, imported_symbol, line FROM imports WHERE resolved_path IN (${placeholders})${symbolClause} ORDER BY importer_path, line`).all(...params);
};

// Breadth-first walk of consumers. Depth 1 honours the symbol filter; deeper hops are file-level.
// Returns [{ path, depth, chain, importedSymbol }] with each path once, at its shallowest depth.
export const walkConsumers = (db, seedPath, { symbol = null, maxDepth = 5 } = {}) => {
  const seen = new Map();
  let frontier = [{ path: seedPath, chain: seedPath }];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const node of frontier) {
      const rows = importersOf(db, node.path, depth === 1 ? symbol : null);
      for (const row of rows) {
        const isKnown = row.importer_path === seedPath || seen.has(row.importer_path);
        if (isKnown) continue;
        const consumer = { path: row.importer_path, depth, chain: `${node.chain} <- ${row.importer_path}`, importedSymbol: row.imported_symbol };
        seen.set(row.importer_path, consumer);
        next.push(consumer);
      }
    }
    const hasFrontier = next.length > 0;
    if (!hasFrontier) break;
    frontier = next;
  }
  return Array.from(seen.values());
};

// Imports of the symbol that could not be resolved to a file (bare or unknown alias specifiers).
export const findUnresolvedImporters = (db, symbol) => {
  const hasSymbol = Boolean(symbol);
  if (!hasSymbol) return [];
  return db.prepare("SELECT DISTINCT importer_path, source_module, line FROM imports WHERE imported_symbol = ? AND resolved_path = '' ORDER BY importer_path")
    .all(symbol).map((r) => ({ path: r.importer_path, sourceModule: r.source_module, line: Number(r.line || 1) }));
};

// One definition per name, chosen deterministically: the preferred file's own definition first,
// then an exported one, then by path. Never whichever row SQLite happens to return first.
const SYMBOL_ROW_SQL = `
  SELECT s.name, s.kind, s.start_line, s.end_line, s.file_path, f.tier
  FROM symbols s JOIN files f ON s.file_path = f.path
  WHERE s.name = ?1
  ORDER BY (s.file_path = ?2) DESC, s.is_export DESC, s.file_path, s.start_line
  LIMIT 1
`;

const IMPORT_EDGE_SQL = `
  SELECT i.resolved_path, s.name, s.kind, s.start_line, s.end_line, s.file_path, f.tier
  FROM imports i
  LEFT JOIN symbols s ON s.file_path = i.resolved_path AND s.name = ?2
  LEFT JOIN files f ON s.file_path = f.path
  WHERE i.importer_path = ?1 AND i.imported_symbol = ?2
  ORDER BY (s.name IS NULL), s.is_export DESC, i.line
  LIMIT 1
`;

export const findSymbolRow = (db, name, preferredPath = '') => db.prepare(SYMBOL_ROW_SQL).get(name, preferredPath);

// A callee named in filePath resolves to filePath's own definition, else to the module filePath
// imports it from (null when that import is a package or unindexed: the caller marks it
// external), and only for names filePath never imports to the deterministic by-name row.
export const findCalleeDefinition = (db, name, filePath) => {
  const byName = findSymbolRow(db, name, filePath);
  const isOwnDefinition = Boolean(byName) && byName.file_path === filePath;
  if (isOwnDefinition) return byName;
  const edge = db.prepare(IMPORT_EDGE_SQL).get(filePath, name);
  const isImported = Boolean(edge);
  if (!isImported) return byName || null;
  const hasIndexedTarget = Boolean(edge.file_path);
  return hasIndexedTarget ? edge : null;
};
