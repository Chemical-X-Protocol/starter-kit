import path from 'node:path';
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
      start_line INTEGER NOT NULL DEFAULT 1,
      end_line INTEGER NOT NULL DEFAULT 1,
      signature TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      importer_path TEXT NOT NULL,
      imported_symbol TEXT NOT NULL,
      source_module TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(importer_path) REFERENCES files(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      pillar TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL,
      directive TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_tier ON files(tier);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
    CREATE INDEX IF NOT EXISTS idx_props_name ON props(name);
    CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks(name);
    CREATE INDEX IF NOT EXISTS idx_imports_symbol ON imports(imported_symbol);
    CREATE INDEX IF NOT EXISTS idx_imports_path ON imports(importer_path);
    CREATE INDEX IF NOT EXISTS idx_violations_file ON violations(file_path);
    CREATE INDEX IF NOT EXISTS idx_violations_rule ON violations(rule);
    CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
      file_path UNINDEXED,
      name,
      kind,
      tier,
      tokens
    );
  `);

  const symbolCols = db.prepare('PRAGMA table_info(symbols)').all() || [];
  const colNames = new Set(symbolCols.map((c) => c.name));
  if (!colNames.has('start_line')) {
    db.exec('ALTER TABLE symbols ADD COLUMN start_line INTEGER NOT NULL DEFAULT 1;');
  }
  if (!colNames.has('end_line')) {
    db.exec('ALTER TABLE symbols ADD COLUMN end_line INTEGER NOT NULL DEFAULT 1;');
  }
  if (!colNames.has('signature')) {
    db.exec("ALTER TABLE symbols ADD COLUMN signature TEXT NOT NULL DEFAULT '';");
  }

  return db;
};
