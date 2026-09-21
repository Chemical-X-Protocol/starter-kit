import './silence-warnings.js';
import path from 'node:path';
import { ensureChemxDir } from './audit/history.js';
import { initTeamSchema } from './team/team-schema.js';

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
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
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
      resolved_path TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS audit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      asi INTEGER NOT NULL,
      total_loc INTEGER NOT NULL,
      scanned_files INTEGER NOT NULL,
      critical_count INTEGER NOT NULL,
      high_med_count INTEGER NOT NULL,
      low_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_name TEXT NOT NULL,
      vector BLOB NOT NULL,
      dimensions INTEGER NOT NULL,
      model TEXT NOT NULL DEFAULT 'fast-subword',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
      file_path UNINDEXED,
      name,
      kind,
      tier,
      tokens
    );
  `);

  // Register in-process hardware-accelerated cosine distance function
  if (typeof db.function === 'function') {
    try {
      db.function('vec_cosine', (b1, b2) => {
        if (!b1 || !b2) return 0;
        const a = new Float32Array(b1.buffer, b1.byteOffset, b1.byteLength / 4);
        const b = new Float32Array(b2.buffer, b2.byteOffset, b2.byteLength / 4);
        let dot = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
          dot += a[i] * b[i];
        }
        return Math.max(0, Math.min(1, dot));
      });
    } catch {
      // Ignored if already registered
    }
  }

  // Column migrations for existing databases before creating indexes
  const symbolCols = db.prepare('PRAGMA table_info(symbols)').all() || [];
  const symbolColNames = new Set(symbolCols.map((c) => c.name));
  if (!symbolColNames.has('start_line')) {
    try { db.exec('ALTER TABLE symbols ADD COLUMN start_line INTEGER NOT NULL DEFAULT 1;'); } catch {}
  }
  if (!symbolColNames.has('end_line')) {
    try { db.exec('ALTER TABLE symbols ADD COLUMN end_line INTEGER NOT NULL DEFAULT 1;'); } catch {}
  }
  if (!symbolColNames.has('signature')) {
    try { db.exec("ALTER TABLE symbols ADD COLUMN signature TEXT NOT NULL DEFAULT '';"); } catch {}
  }

  const fileCols = db.prepare('PRAGMA table_info(files)').all() || [];
  const fileColNames = new Set(fileCols.map((c) => c.name));
  if (!fileColNames.has('health_score')) {
    try { db.exec('ALTER TABLE files ADD COLUMN health_score INTEGER NOT NULL DEFAULT 100;'); } catch {}
  }
  if (!fileColNames.has('hazard_count')) {
    try { db.exec('ALTER TABLE files ADD COLUMN hazard_count INTEGER NOT NULL DEFAULT 0;'); } catch {}
  }

  const importCols = db.prepare('PRAGMA table_info(imports)').all() || [];
  const importColNames = new Set(importCols.map((c) => c.name));
  if (!importColNames.has('resolved_path')) {
    try { db.exec("ALTER TABLE imports ADD COLUMN resolved_path TEXT NOT NULL DEFAULT '';"); } catch {}
  }

  // Safely create all indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_tier ON files(tier);
    CREATE INDEX IF NOT EXISTS idx_files_health ON files(health_score);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
    CREATE INDEX IF NOT EXISTS idx_props_name ON props(name);
    CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks(name);
    CREATE INDEX IF NOT EXISTS idx_imports_symbol ON imports(imported_symbol);
    CREATE INDEX IF NOT EXISTS idx_imports_path ON imports(importer_path);
    CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_path);
    CREATE INDEX IF NOT EXISTS idx_embeddings_file ON embeddings(file_path);
    CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(target_type);
    CREATE INDEX IF NOT EXISTS idx_violations_file ON violations(file_path);
    CREATE INDEX IF NOT EXISTS idx_violations_rule ON violations(rule);
    CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);
    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON audit_snapshots(timestamp);
  `);

  initTeamSchema(db);

  return db;
};
