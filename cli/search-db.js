import fs from 'node:fs';
import path from 'node:path';
import { generateEmbedding, serializeVector, VECTOR_DIMENSIONS } from './embeddings/vectorizer.js';
import { buildFtsTokens } from './search-tokenizer.js';

export {
  isSqliteAvailable,
  resolveIndexDbPath,
  openIndexDb,
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

export const getAllIndexedFiles = (db) => {
  if (!db) return new Map();
  const rows = db.prepare('SELECT path, mtime, size FROM files').all();
  const fileMap = new Map();
  for (const row of rows) {
    fileMap.set(row.path, { mtime: Number(row.mtime), size: Number(row.size) });
  }
  return fileMap;
};

export const removeDeletedFiles = (db, currentFilePaths, cwd = process.cwd()) => {
  if (!db) return 0;
  const indexed = getAllIndexedFiles(db);
  let removedCount = 0;

  const deleteStmt = db.prepare('DELETE FROM files WHERE path = ?');
  const deleteFtsStmt = db.prepare('DELETE FROM fts_index WHERE file_path = ?');
  const deleteImportsStmt = db.prepare('DELETE FROM imports WHERE importer_path = ?');

  for (const [filePath] of indexed.entries()) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const isFileMissing = !fs.existsSync(fullPath);
    if (isFileMissing) {
      deleteStmt.run(filePath);
      deleteFtsStmt.run(filePath);
      deleteImportsStmt.run(filePath);
      removedCount += 1;
    }
  }

  return removedCount;
};

export const resolveModulePath = (importerPath, sourceModule, cwd = process.cwd()) => {
  if (!sourceModule || typeof sourceModule !== 'string') return '';
  const isRelative = sourceModule.startsWith('.') || sourceModule.startsWith('/');
  const isAliased = sourceModule.startsWith('@/');
  if (!isRelative && !isAliased) return '';

  let basePath;
  if (isAliased) {
    basePath = path.resolve(cwd, 'src', sourceModule.slice(2));
  } else {
    basePath = path.resolve(cwd, path.dirname(importerPath), sourceModule);
  }

  const extensions = ['', '.ts', '.js', '.vue', '.tsx', '.jsx', '.d.ts'];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(cwd, candidate);
    }
  }

  for (const ext of ['.ts', '.js', '.vue', '.tsx', '.jsx', '.d.ts']) {
    const indexCandidate = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return path.relative(cwd, indexCandidate);
    }
  }

  // Fallback path normalization for virtual/mock files
  if (isAliased) {
    return path.normalize(path.join('src', sourceModule.slice(2)));
  }
  return path.normalize(path.join(path.dirname(importerPath), sourceModule));
};

export const upsertFileIndex = (db, record) => {
  if (!db) return;
  const {
    path: filePath,
    mtime,
    size,
    tier,
    lines,
    chars,
    symbols = [],
    props = [],
    hooks = [],
    imports = []
  } = record;

  // Clean old entries for this file
  db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  db.prepare('DELETE FROM fts_index WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM imports WHERE importer_path = ?').run(filePath);
  db.prepare('DELETE FROM embeddings WHERE file_path = ?').run(filePath);

  // Insert file record
  const insertFileStmt = db.prepare(`
    INSERT INTO files (path, mtime, size, tier, lines, chars)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertFileStmt.run(filePath, mtime, size, tier, lines, chars);

  // Insert symbols with line locations and signature
  if (symbols.length > 0) {
    const insertSymbolStmt = db.prepare(`
      INSERT INTO symbols (file_path, name, kind, is_export, start_line, end_line, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const sym of symbols) {
      insertSymbolStmt.run(
        filePath,
        sym.name,
        sym.kind,
        sym.isExport ? 1 : 0,
        sym.startLine || 1,
        sym.endLine || sym.startLine || 1,
        sym.signature || ''
      );
    }
  }

  // Insert props
  if (props.length > 0) {
    const insertPropStmt = db.prepare(`
      INSERT INTO props (file_path, name, prop_type)
      VALUES (?, ?, ?)
    `);
    for (const p of props) {
      insertPropStmt.run(filePath, p.name, p.type || '');
    }
  }

  // Insert hooks
  if (hooks.length > 0) {
    const insertHookStmt = db.prepare(`
      INSERT INTO hooks (file_path, name)
      VALUES (?, ?)
    `);
    for (const h of hooks) {
      insertHookStmt.run(filePath, h);
    }
  }

  // Insert imports with resolved relative paths
  if (imports.length > 0) {
    const insertImportStmt = db.prepare(`
      INSERT INTO imports (importer_path, imported_symbol, source_module, resolved_path, line)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const imp of imports) {
      const resolved = resolveModulePath(filePath, imp.sourceModule);
      insertImportStmt.run(filePath, imp.importedSymbol, imp.sourceModule, resolved, imp.line || 1);
    }
  }

  // Insert into FTS index
  const tokensText = buildFtsTokens({ symbols, props, hooks, imports, filePath });
  const mainName = symbols.find((s) => s.isExport)?.name || path.basename(filePath);

  db.prepare(`
    INSERT INTO fts_index (file_path, name, kind, tier, tokens)
    VALUES (?, ?, ?, ?, ?)
  `).run(filePath, mainName, tier, tier, tokensText);

  // Insert vector embeddings
  try {
    const insertEmbeddingStmt = db.prepare(`
      INSERT INTO embeddings (file_path, target_type, target_name, vector, dimensions, model, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const fileVec = generateEmbedding(`${mainName} ${tier} ${tokensText}`);
    insertEmbeddingStmt.run(filePath, 'capsule', mainName, serializeVector(fileVec), VECTOR_DIMENSIONS, 'fast-subword', Date.now());

    for (const s of symbols) {
      if (s.isExport) {
        const symText = `${s.name} ${s.kind} ${s.signature || ''}`;
        const symVec = generateEmbedding(symText);
        insertEmbeddingStmt.run(filePath, 'symbol', s.name, serializeVector(symVec), VECTOR_DIMENSIONS, 'fast-subword', Date.now());
      }
    }
  } catch {
    // Graceful degradation if vector generation fails
  }
};

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
  } catch {
    // Non-blocking FTS fallback
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
