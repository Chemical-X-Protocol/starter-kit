// Forge fingerprint ledger DDL (design doc, Data model). search-schema-ddl.js only calls
// applyPatternSchema, so the index schema file stays small. P2 owns the two ledger tables:
//   pattern_files  one row per fingerprinted file: content stamp, facet and extractor version
//   pattern_units  one row per stored unit (fn, stmt, expr, tmpl), cascading from pattern_files;
//                  inner_fp1..3 hold the fps of an expression statement's expression (unit-floor.js)
// P3 owns the grouping tables (group-store.js):
//   pattern_groups         one row per group of the last run, accepted or rejected, with its reason code,
//                          score and LGG (lgg_json, the verdict cache keyed by source_id)
//   pattern_group_members  the units of each group by role (member, drift, evicted) with a reason
//   pattern_suppressions   `chemx patterns reject`: a group key (stable under line drift) and its reason
//   pattern_unify_cache    W merge decisions by instance pair (content-derived keys)
//   pattern_shape_cache    drift root shapes by unit (kind and content-derived key)
//   pattern_run_cache      the last whole-run result per scope under its run key (run-cache.js)
// Later phases add their tables (blueprints, heal runs, library) here.
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
    inner_fp1 TEXT,
    inner_fp2 TEXT,
    inner_fp3 TEXT,
    facet_key TEXT NOT NULL,
    is_spec INTEGER NOT NULL DEFAULT 0,
    meta TEXT,
    FOREIGN KEY(file_path) REFERENCES pattern_files(path) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pattern_groups (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    facet_key TEXT NOT NULL,
    member_count INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    mass INTEGER NOT NULL,
    hole_count INTEGER NOT NULL DEFAULT 0,
    hole_ratio REAL NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    reject_reason TEXT,
    lgg_json TEXT,
    depends_on TEXT,
    extractor_version INTEGER NOT NULL,
    source_id TEXT,
    suppression_key TEXT
  );

  CREATE TABLE IF NOT EXISTS pattern_group_members (
    group_id TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('home', 'member', 'drift', 'evicted')),
    reason TEXT,
    PRIMARY KEY (group_id, unit_id)
  );

  CREATE TABLE IF NOT EXISTS pattern_suppressions (
    key_hash TEXT NOT NULL,
    path TEXT NOT NULL,
    reason TEXT,
    by_agent TEXT,
    decision_post_id INTEGER,
    created_at INTEGER,
    PRIMARY KEY (key_hash, path)
  );

  CREATE TABLE IF NOT EXISTS pattern_unify_cache (
    pair_key TEXT PRIMARY KEY,
    ok INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pattern_shape_cache (
    row_key TEXT PRIMARY KEY,
    shape TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pattern_run_cache (
    scope_key TEXT PRIMARY KEY,
    run_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp1 ON pattern_units(fp1, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp2 ON pattern_units(fp2, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_fp3 ON pattern_units(fp3, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_inner_fp1 ON pattern_units(inner_fp1, facet_key) WHERE inner_fp1 IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_pattern_units_inner_fp2 ON pattern_units(inner_fp2, facet_key) WHERE inner_fp2 IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_pattern_units_inner_fp3 ON pattern_units(inner_fp3, facet_key) WHERE inner_fp3 IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_pattern_units_file ON pattern_units(file_path);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_block ON pattern_units(file_path, block_id, ordinal);
  CREATE INDEX IF NOT EXISTS idx_pattern_units_decl ON pattern_units(decl_name, facet_key);
  CREATE INDEX IF NOT EXISTS idx_pattern_groups_source ON pattern_groups(source_id);
  CREATE INDEX IF NOT EXISTS idx_pattern_group_members_unit ON pattern_group_members(unit_id);
`;

// [table, column, definition]: columns added after a ledger table first shipped.
const COLUMN_MIGRATIONS = [
  ['pattern_units', 'inner_fp1', 'TEXT'],
  ['pattern_units', 'inner_fp2', 'TEXT'],
  ['pattern_units', 'inner_fp3', 'TEXT']
];

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
