import path from 'node:path';
import fs from 'node:fs';
import { ensureChemxDir } from './audit/history.js';

let DatabaseSync = null;
try {
  const sqliteModule = await import('node:sqlite');
  DatabaseSync = sqliteModule.DatabaseSync;
} catch {
  DatabaseSync = null;
}

export const isSqliteAvailable = () => Boolean(DatabaseSync);

export const resolveIndexDbPath = (cwd = process.cwd()) => {
  const dir = ensureChemxDir(cwd);
  return path.join(dir, 'index.db');
};

export const openIndexDb = (cwd = process.cwd()) => {
  if (!DatabaseSync) return null;
  const dbPath = resolveIndexDbPath(cwd);
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      is_export INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      prop_type TEXT,
      FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_files_tier ON files(tier);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
    CREATE INDEX IF NOT EXISTS idx_props_name ON props(name);
    CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks(name);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
      file_path UNINDEXED,
      name,
      kind,
      tier,
      tokens
    );
  `);

  return db;
};

export const getAllIndexedFiles = (db) => {
  if (!db) return new Map();
  const rows = db.prepare('SELECT path, mtime, size FROM files').all();
  const fileMap = new Map();
  for (const row of rows) {
    fileMap.set(row.path, { mtime: Number(row.mtime), size: Number(row.size) });
  }
  return fileMap;
};

export const removeDeletedFiles = (db, currentFilePaths) => {
  if (!db) return 0;
  const indexed = getAllIndexedFiles(db);
  const currentSet = new Set(currentFilePaths);
  let removedCount = 0;

  const deleteStmt = db.prepare('DELETE FROM files WHERE path = ?');
  const deleteFtsStmt = db.prepare('DELETE FROM fts_index WHERE file_path = ?');

  for (const [filePath] of indexed.entries()) {
    const isFileMissing = !currentSet.has(filePath);
    if (isFileMissing) {
      deleteStmt.run(filePath);
      deleteFtsStmt.run(filePath);
      removedCount += 1;
    }
  }

  return removedCount;
};

export const upsertFileIndex = (db, record) => {
  if (!db) return;
  const { path: filePath, mtime, size, tier, lines, chars, symbols = [], props = [], hooks = [] } = record;

  // Clean old entries for this file
  db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  db.prepare('DELETE FROM fts_index WHERE file_path = ?').run(filePath);

  // Insert file record
  const insertFileStmt = db.prepare(`
    INSERT INTO files (path, mtime, size, tier, lines, chars)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertFileStmt.run(filePath, mtime, size, tier, lines, chars);

  // Insert symbols
  if (symbols.length > 0) {
    const insertSymbolStmt = db.prepare(`
      INSERT INTO symbols (file_path, name, kind, is_export)
      VALUES (?, ?, ?, ?)
    `);
    for (const sym of symbols) {
      insertSymbolStmt.run(filePath, sym.name, sym.kind, sym.isExport ? 1 : 0);
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

  // Insert into FTS index
  const tokenList = [
    ...symbols.map((s) => s.name),
    ...props.map((p) => p.name),
    ...hooks,
    filePath
  ];
  const tokensText = tokenList.join(' ');
  const mainName = symbols.find((s) => s.isExport)?.name || path.basename(filePath);

  db.prepare(`
    INSERT INTO fts_index (file_path, name, kind, tier, tokens)
    VALUES (?, ?, ?, ?, ?)
  `).run(filePath, mainName, tier, tier, tokensText);
};

export const queryIndex = (db, { query = '', tier = null, kind = null, limit = 50 } = {}) => {
  if (!db) return [];

  const cleanQuery = query.trim();
  const hasQuery = cleanQuery.length > 0;

  if (!hasQuery) {
    let sql = 'SELECT * FROM files';
    const params = [];
    if (tier) {
      sql += ' WHERE tier = ?';
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
  return matchedFiles.map((f) => populateFileDetails(db, f));
};

export const inspectIndexedFile = (db, filePath) => {
  if (!db) return null;
  const fileRow = db.prepare('SELECT * FROM files WHERE path = ? OR path LIKE ?').get(filePath, `%${filePath}%`);
  if (!fileRow) return null;
  return populateFileDetails(db, fileRow);
};

export const getIndexStats = (db) => {
  if (!db) return { totalFiles: 0, totalSymbols: 0, totalProps: 0, totalHooks: 0 };
  const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get()?.count || 0;
  const symbolCount = db.prepare('SELECT COUNT(*) as count FROM symbols').get()?.count || 0;
  const propCount = db.prepare('SELECT COUNT(*) as count FROM props').get()?.count || 0;
  const hookCount = db.prepare('SELECT COUNT(*) as count FROM hooks').get()?.count || 0;
  return {
    totalFiles: Number(fileCount),
    totalSymbols: Number(symbolCount),
    totalProps: Number(propCount),
    totalHooks: Number(hookCount)
  };
};

const populateFileDetails = (db, fileRow) => {
  const symbols = db.prepare('SELECT name, kind, is_export FROM symbols WHERE file_path = ?').all(fileRow.path);
  const props = db.prepare('SELECT name, prop_type FROM props WHERE file_path = ?').all(fileRow.path);
  const hooks = db.prepare('SELECT name FROM hooks WHERE file_path = ?').all(fileRow.path);

  return {
    path: fileRow.path,
    tier: fileRow.tier,
    lines: Number(fileRow.lines),
    chars: Number(fileRow.chars),
    mtime: Number(fileRow.mtime),
    size: Number(fileRow.size),
    symbols: symbols.map((s) => ({ name: s.name, kind: s.kind, isExport: Boolean(s.is_export) })),
    props: props.map((p) => ({ name: p.name, type: p.prop_type })),
    hooks: hooks.map((h) => h.name)
  };
};
