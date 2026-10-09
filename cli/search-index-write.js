// Index row writes. Every write runs inside one IMMEDIATE transaction (or joins the caller's),
// so concurrent processes serialise instead of racing DELETE/INSERT into UNIQUE failures.
import path from 'node:path';
import { generateEmbedding, serializeVector, VECTOR_DIMENSIONS } from './embeddings/vectorizer.js';
import { buildFtsTokens } from './search-tokenizer.js';
import { resolveModulePath } from './search-resolve.js';
import { withImmediateTransaction } from './team/team-db-transaction.js';
import { INDEX_VERSION } from './search-index-meta.js';

export const EMBEDDING_MODEL = 'feature-hash-128';

const STATEMENTS = new WeakMap();

const SQL = {
  deleteFile: 'DELETE FROM files WHERE path = ?',
  deleteSymbols: 'DELETE FROM symbols WHERE file_path = ?',
  deleteProps: 'DELETE FROM props WHERE file_path = ?',
  deleteHooks: 'DELETE FROM hooks WHERE file_path = ?',
  deleteImports: 'DELETE FROM imports WHERE importer_path = ?',
  deleteEmbeddings: 'DELETE FROM embeddings WHERE file_path = ?',
  deleteFts: 'DELETE FROM fts_index WHERE file_path = ?',
  insertFile: 'INSERT INTO files (path, mtime, size, tier, lines, chars, extractor_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
  insertSymbol: 'INSERT INTO symbols (file_path, name, kind, is_export, start_line, end_line, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
  insertProp: 'INSERT INTO props (file_path, name, prop_type) VALUES (?, ?, ?)',
  insertHook: 'INSERT INTO hooks (file_path, name) VALUES (?, ?)',
  insertImport: 'INSERT INTO imports (importer_path, imported_symbol, source_module, resolved_path, line) VALUES (?, ?, ?, ?, ?)',
  insertFts: 'INSERT INTO fts_index (file_path, name, kind, tier, tokens) VALUES (?, ?, ?, ?, ?)',
  insertEmbedding: 'INSERT INTO embeddings (file_path, target_type, target_name, vector, dimensions, model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
};

const statementsFor = (db) => {
  const cached = STATEMENTS.get(db);
  if (cached) return cached;
  const prepared = {};
  for (const [name, sql] of Object.entries(SQL)) prepared[name] = db.prepare(sql);
  STATEMENTS.set(db, prepared);
  return prepared;
};

export const withIndexTransaction = (db, callback, maxRetries = 5) => {
  const isAlreadyInTransaction = db.isTransaction === true;
  if (isAlreadyInTransaction) return callback();
  return withImmediateTransaction(db, callback, maxRetries);
};

// Explicit deletes (not only ON DELETE CASCADE) so rows go even when foreign_keys is off.
export const deleteFileRows = (db, filePath) => {
  const s = statementsFor(db);
  for (const name of ['deleteSymbols', 'deleteProps', 'deleteHooks', 'deleteImports', 'deleteEmbeddings', 'deleteFts', 'deleteFile']) {
    s[name].run(filePath);
  }
};

const insertEmbeddings = (s, filePath, mainName, tier, tokensText, symbols) => {
  const now = Date.now();
  const fileVec = generateEmbedding(`${mainName} ${tier} ${tokensText}`);
  s.insertEmbedding.run(filePath, 'capsule', mainName, serializeVector(fileVec), VECTOR_DIMENSIONS, EMBEDDING_MODEL, now);
  for (const sym of symbols) {
    const isExported = Boolean(sym.isExport);
    if (!isExported) continue;
    const symVec = generateEmbedding(`${sym.name} ${sym.kind} ${sym.signature || ''}`);
    s.insertEmbedding.run(filePath, 'symbol', sym.name, serializeVector(symVec), VECTOR_DIMENSIONS, EMBEDDING_MODEL, now);
  }
};

const writeFileRows = (db, record) => {
  const s = statementsFor(db);
  const { path: filePath, mtime, size, tier, lines, chars, symbols = [], props = [], hooks = [], imports = [] } = record;
  const root = record.root || process.cwd();

  deleteFileRows(db, filePath);
  s.insertFile.run(filePath, mtime, size, tier, lines, chars, INDEX_VERSION);
  for (const sym of symbols) {
    const startLine = sym.startLine || 1;
    s.insertSymbol.run(filePath, sym.name, sym.kind, sym.isExport ? 1 : 0, startLine, sym.endLine || startLine, sym.signature || '');
  }
  for (const p of props) s.insertProp.run(filePath, p.name, p.type || '');
  for (const h of hooks) s.insertHook.run(filePath, h);
  for (const imp of imports) {
    const resolved = resolveModulePath(filePath, imp.sourceModule, root);
    s.insertImport.run(filePath, imp.importedSymbol, imp.sourceModule, resolved, imp.line || 1);
  }

  const tokensText = buildFtsTokens({ symbols, props, hooks, imports, filePath });
  const mainName = symbols.find((sym) => sym.isExport)?.name || path.basename(filePath);
  s.insertFts.run(filePath, mainName, tier, tier, tokensText);
  insertEmbeddings(s, filePath, mainName, tier, tokensText, symbols);
};

export const upsertFileIndex = (db, record) => {
  if (!db) return;
  withIndexTransaction(db, () => writeFileRows(db, record));
};

// Writes many records in bounded transactions so a cold build never holds the write lock
// for the whole parse, yet still avoids one autocommit per statement.
export const upsertFileIndexBatch = (db, records, batchSize = 200) => {
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    withIndexTransaction(db, () => {
      for (const record of batch) writeFileRows(db, record);
    });
  }
};

export const deleteFileIndexRows = (db, filePaths) => {
  const hasPaths = filePaths.length > 0;
  if (!hasPaths) return 0;
  withIndexTransaction(db, () => {
    for (const filePath of filePaths) deleteFileRows(db, filePath);
  });
  return filePaths.length;
};
