// Forge fingerprint ledger DDL (design doc, Data model). search-schema-ddl.js only calls
// applyPatternSchema, so the index schema file stays small. P2 owns the two ledger tables:
//   pattern_files  one row per fingerprinted file: content stamp, facet and extractor version
//   pattern_units  one row per stored unit (fn, stmt, expr, tmpl), cascading from pattern_files
// Later phases add their tables (groups, blueprints, heal runs, library) here.
import { debugNote } from '../search-debug.js';

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS pattern_files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL,
    facet_key TEXT NOT NULL,
    extractor_version INTEGER NOT NULL,
    unit_count INTEGER NOT NULL DEFAULT 0,
    dropped_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pattern_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('fn', 'stmt', 'expr', 'tmpl')),
    block_id INTEGER,
    ordinal INTEGER,
    start INTEGER,
    end INTEGER,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    decl_name TEXT,
    is_export INTEGER,
    mass INTEGER NOT NULL,
    anchor_weight REAL NOT NULL,
    anchors TEXT NOT NULL,
    fp1 TEXT NOT NULL,
    fp2 TEXT NOT NULL,
    fp3 TEXT NOT NULL,
    facet_key TEXT NOT NULL,
    is_spec INTEGER NOT NULL DEFAULT 0,
    meta TEXT,
    FOREIGN KEY(file_path) REFERENCES pattern_files(path) ON DELETE CASCADE
  );
`;

const INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp1 ON pattern_units(fp1, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp2 ON pattern_units(fp2, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp3 ON pattern_units(fp3, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_file ON pattern_units(file_path);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_block ON pattern_units(file_path, block_id, ordinal);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_decl ON pattern_units(decl_name, facet_key);
`;

// [table, column, definition]: columns added after a ledger table first shipped.
const COLUMN_MIGRATIONS = [];

const columnsOf = (db, table) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));

const migrateColumns = (db) => {
  for (const [table, column, definition] of COLUMN_MIGRATIONS) {
    const isMissing = !columnsOf(db, table).has(column);
    if (isMissing) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`); } catch (err) { debugNote.warn(`migrate ${table}.${column}`, err); }
    }
  }
};

/** Creates the Forge ledger tables and indexes (idempotent). */
export const applyPatternSchema = (db) => {
  db.exec(TABLES_SQL);
  migrateColumns(db);
  db.exec(INDEXES_SQL);
};
