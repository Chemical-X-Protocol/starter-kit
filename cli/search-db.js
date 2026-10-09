
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

export const getAllIndexedFiles = (db) => {
  if (!db) return new Map();
  const rows = db.prepare('SELECT path, mtime, size FROM files').all();
  const fileMap = new Map();
  for (const row of rows) {
    fileMap.set(row.path, { mtime: Number(row.mtime), size: Number(row.size) });
  }
  return fileMap;
};

export { resolveModulePath, moduleKeysFor } from './search-resolve.js';
export { upsertFileIndex, upsertFileIndexBatch, deleteFileIndexRows, withIndexTransaction } from './search-index-write.js';

export const queryIndex = (db, { query = '', tier = null, kind = null, limit = 50 } = {}) => {
  if (!db) return [];

  const cleanQuery = query.trim();
  const hasQuery = cleanQuery.length > 0;

  if (!hasQuery) {
    let sql = 'SELECT * FROM files';
    const params = [];
    if (tier) {
      sql = 'SELECT * FROM files WHERE tier = ?';
      params.push(tier);
    }
    sql += ' ORDER BY path ASC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => populateFileDetails(db, r));
  }

  // Search via symbols, path, or FTS
  const wildcard = `%${cleanQuery}%`;
  let sql = `
    SELECT DISTINCT f.*
    FROM files f
    LEFT JOIN symbols s ON f.path = s.file_path
    LEFT JOIN props p ON f.path = p.file_path
    LEFT JOIN hooks h ON f.path = h.file_path
    WHERE (
      f.path LIKE ?
      OR s.name LIKE ?
      OR p.name LIKE ?
      OR h.name LIKE ?
    )
  `;
  const params = [wildcard, wildcard, wildcard, wildcard];

  if (tier) {
    sql += ' AND f.tier = ?';
    params.push(tier);
  }

  sql += ' ORDER BY (f.path LIKE ?) DESC, f.lines ASC LIMIT ?';
  params.push(wildcard, limit);

  const matchedFiles = db.prepare(sql).all(...params);
  if (matchedFiles.length > 0) {
    return matchedFiles.map((f) => populateFileDetails(db, f));
  }

  try {
    const clean = cleanQuery.replace(/[^\w\s-]/g, ' ').trim();
    if (clean) {
      const ftsRows = db.prepare(`
        SELECT DISTINCT file_path FROM fts_index
        WHERE fts_index MATCH ?
        LIMIT ?
      `).all(`"${clean}"*`, limit);

      if (ftsRows.length > 0) {
        const placeholders = ftsRows.map(() => '?').join(',');
        const ftsFiles = db.prepare(`
          SELECT * FROM files WHERE path IN (${placeholders})
          ORDER BY lines ASC
        `).all(...ftsRows.map((r) => r.file_path));
        return ftsFiles.map((f) => populateFileDetails(db, f));
      }
    }
  } catch (err) {
    debugNote.warn('fts fallback', err);
  }

  return [];
};

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
