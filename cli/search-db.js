
export {
  isSqliteAvailable,
  resolveIndexDbPath,
  openIndexDb,
  getIndexDbState,
  warmIndexDb,
  clearDbCache
} from './search-schema.js';

export {
  findSymbolDefinition,
  findSymbolReferences,
  findFileDependencies,
  findFileDependents,
  calculateBlastRadius,
  calculateCallTrace,
  calculateBacktrace,
  querySemanticIndex,
  queryHybridIndex,
  syncViolationsIndex,
  queryViolations,
  recordAuditSnapshot,
  getAuditProgression,
  queryFilesByHealth
} from './search-queries.js';

import { debugNote } from './search-debug.js';
import { rankIndexHits } from './search-rank.js';
import { isPathInScope, scopeSqlFilter } from './search-root.js';

export const getAllIndexedFiles = (db) => {
  if (!db) return new Map();
  const rows = db.prepare('SELECT path, mtime, size, extractor_version FROM files').all();
  const fileMap = new Map();
  for (const row of rows) {
    const version = row.extractor_version === null ? null : Number(row.extractor_version);
    fileMap.set(row.path, { mtime: Number(row.mtime), size: Number(row.size), version });
  }
  return fileMap;
};

export { resolveModulePath, moduleKeysFor } from './search-resolve.js';
export { upsertFileIndex, upsertFileIndexBatch, deleteFileIndexRows, withIndexTransaction } from './search-index-write.js';

const FILE_ROW_SQL = 'SELECT * FROM files WHERE path = ?';

const queryFtsFallback = (db, cleanQuery, limit) => {
  const clean = cleanQuery.replace(/[^\w\s-]/g, ' ').trim();
  const hasTerms = clean.length > 0;
  if (!hasTerms) return [];
  try {
    const ftsRows = db.prepare('SELECT DISTINCT file_path FROM fts_index WHERE fts_index MATCH ?').all(`"${clean}"*`);
    const paths = ftsRows.map((r) => r.file_path);
    return paths.map((p) => db.prepare(FILE_ROW_SQL).get(p)).filter(Boolean)
      .sort((a, b) => Number(a.lines) - Number(b.lines))
      .map((row) => ({ path: row.path, rank: 0, type: 'fts', name: null, line: null }));
  } catch (err) {
    debugNote.warn('fts fallback', err);
    return [];
  }
};

// Ranked page of matches: { results, total, truncated, limit }. Each result carries `match`.
// scopeDirs (root-relative) limits answers to the scope the caller synced; null means every row.
export const queryIndexPage = (db, { query = '', tier = null, limit = 50, scopeDirs = null } = {}) => {
  const emptyPage = { results: [], total: 0, truncated: false, limit };
  if (!db) return emptyPage;
  const cleanQuery = query.trim();
  const hasQuery = cleanQuery.length > 0;
  const hasTierFilter = Boolean(tier) && tier !== 'all';
  const scopeFilter = scopeSqlFilter('path', scopeDirs);

  if (!hasQuery) {
    const where = ` WHERE ${scopeFilter.sql}${hasTierFilter ? ' AND tier = ?' : ''}`;
    const params = hasTierFilter ? [...scopeFilter.params, tier] : scopeFilter.params;
    const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM files${where}`).get(...params)?.c || 0);
    const rows = db.prepare(`SELECT * FROM files${where} ORDER BY path ASC LIMIT ?`).all(...params, limit);
    return { results: rows.map((r) => populateFileDetails(db, r)), total, truncated: total > rows.length, limit };
  }

  const isScoped = Array.isArray(scopeDirs) && scopeDirs.length > 0;
  const isInScope = (hit) => !isScoped || isPathInScope(hit.path, scopeDirs);
  const ranked = rankIndexHits(db, cleanQuery, tier).filter(isInScope);
  const hits = ranked.length > 0 ? ranked : queryFtsFallback(db, cleanQuery, limit).filter(isInScope);
  const page = hits.slice(0, limit);
  const results = page.map((hit) => {
    const details = populateFileDetails(db, db.prepare(FILE_ROW_SQL).get(hit.path));
    return { ...details, match: { type: hit.type, name: hit.name, line: hit.line } };
  });
  return { results, total: hits.length, truncated: hits.length > page.length, limit };
};

export const queryIndex = (db, options = {}) => queryIndexPage(db, options).results;

export const inspectIndexedFile = (db, filePath) => {
  if (!db) return null;
  const fileRow = db.prepare('SELECT * FROM files WHERE path = ? OR path LIKE ?').get(filePath, `%${filePath}%`);
  if (!fileRow) return null;
  return populateFileDetails(db, fileRow);
};

export const getIndexStats = (db) => {
  if (!db) {
    return {
      totalFiles: 0,
      totalSymbols: 0,
      totalProps: 0,
      totalHooks: 0,
      totalImports: 0,
      totalViolations: 0
    };
  }
  const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get()?.count || 0;
  const symbolCount = db.prepare('SELECT COUNT(*) as count FROM symbols').get()?.count || 0;
  const propCount = db.prepare('SELECT COUNT(*) as count FROM props').get()?.count || 0;
  const hookCount = db.prepare('SELECT COUNT(*) as count FROM hooks').get()?.count || 0;
  const importCount = db.prepare('SELECT COUNT(*) as count FROM imports').get()?.count || 0;
  const violationCount = db.prepare('SELECT COUNT(*) as count FROM violations').get()?.count || 0;
  return {
    totalFiles: Number(fileCount),
    totalSymbols: Number(symbolCount),
    totalProps: Number(propCount),
    totalHooks: Number(hookCount),
    totalImports: Number(importCount),
    totalViolations: Number(violationCount)
  };
};

const populateFileDetails = (db, fileRow) => {
  const symbols = db.prepare('SELECT name, kind, is_export, start_line, end_line, signature FROM symbols WHERE file_path = ?').all(fileRow.path);
  const props = db.prepare('SELECT name, prop_type FROM props WHERE file_path = ?').all(fileRow.path);
  const hooks = db.prepare('SELECT name FROM hooks WHERE file_path = ?').all(fileRow.path);
  const imports = db.prepare('SELECT imported_symbol, source_module, line FROM imports WHERE importer_path = ?').all(fileRow.path);

  return {
    path: fileRow.path,
    tier: fileRow.tier,
    lines: Number(fileRow.lines),
    chars: Number(fileRow.chars),
    mtime: Number(fileRow.mtime),
    size: Number(fileRow.size),
    symbols: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      isExport: Boolean(s.is_export),
      startLine: Number(s.start_line || 1),
      endLine: Number(s.end_line || 1),
      signature: s.signature || ''
    })),
    props: props.map((p) => ({ name: p.name, type: p.prop_type })),
    hooks: hooks.map((h) => h.name),
    imports: imports.map((i) => ({
      importedSymbol: i.imported_symbol,
      sourceModule: i.source_module,
      line: Number(i.line || 1)
    }))
  };
};
