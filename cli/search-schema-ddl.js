// Search index DDL: tables, column migrations and indexes. Pure schema, no policy.
import { debugNote } from './search-debug.js';
import { applyPatternSchema } from './forge/pattern-schema-ddl.js';

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    size INTEGER NOT NULL,
    tier TEXT NOT NULL,
    lines INTEGER NOT NULL,
    chars INTEGER NOT NULL,
    health_score INTEGER NOT NULL DEFAULT 100,
    hazard_count INTEGER NOT NULL DEFAULT 0,
    extractor_version INTEGER,
    content_hash TEXT,
    synced_at INTEGER
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

  CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
    file_path UNINDEXED,
    name,
    kind,
    tier,
    tokens
  );
`;

const INDEXES_SQL = `
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
`;

const COLUMN_MIGRATIONS = [
  ['symbols', 'start_line', 'INTEGER NOT NULL DEFAULT 1'],
  ['symbols', 'end_line', 'INTEGER NOT NULL DEFAULT 1'],
  ['symbols', 'signature', "TEXT NOT NULL DEFAULT ''"],
  ['files', 'health_score', 'INTEGER NOT NULL DEFAULT 100'],
  ['files', 'hazard_count', 'INTEGER NOT NULL DEFAULT 0'],
  // NULL marks a row written by a chemx that predates per-row stamping: re-parsed, never trusted.
  ['files', 'extractor_version', 'INTEGER'],
  // Racy-clean check (index-row-check.js, #2552): sha1 of the parsed content and the ms time the
  // row was synced. NULL (rows from an older chemx) makes the row racy with no hash: re-parsed once.
  ['files', 'content_hash', 'TEXT'],
  ['files', 'synced_at', 'INTEGER'],
  ['imports', 'resolved_path', "TEXT NOT NULL DEFAULT ''"]
];

const migrateColumns = (db) => {
  for (const [table, column, definition] of COLUMN_MIGRATIONS) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
    const isMissing = !existing.has(column);
    if (isMissing) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`); } catch (err) { debugNote.warn(`migrate ${table}.${column}`, err); }
    }
  }
};

export const applyIndexSchema = (db) => {
  db.exec(TABLES_SQL);
  migrateColumns(db);
  db.exec(INDEXES_SQL);
  applyPatternSchema(db);
};

const cosine = (b1, b2) => {
  const hasBothVectors = Boolean(b1) && Boolean(b2);
  if (!hasBothVectors) return 0;
  const a = new Float32Array(b1.buffer, b1.byteOffset, b1.byteLength / 4);
  const b = new Float32Array(b2.buffer, b2.byteOffset, b2.byteLength / 4);
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
};

export const registerVectorFunctions = (db) => {
  const canRegister = typeof db.function === 'function';
  if (!canRegister) return;
  try { db.function('vec_cosine', cosine); } catch (err) { debugNote.warn('vec_cosine registration', err); }
};
