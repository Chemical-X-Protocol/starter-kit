import { debugNote } from './search-debug.js';

// Index provenance: which extractor version built the rows, and which scope they cover.
// Rows built by another version are never served: the index is wiped and rebuilt instead.

// Bump whenever the extractor, module resolver, ignore rules or tier rules change meaning.
// v2: version stamping, anchored directory exclusions, root-relative module resolution.
export const INDEX_VERSION = 2;

const INDEX_ROW_TABLES = ['symbols', 'props', 'hooks', 'imports', 'embeddings', 'fts_index', 'files'];

export const readIndexMeta = (db) => {
  const meta = { version: null, scope: null, syncedAt: null };
  try {
    const rows = db.prepare('SELECT key, value FROM index_meta').all();
    for (const row of rows) meta[row.key] = row.value;
  } catch {
    return meta;
  }
  const hasVersion = meta.version !== null && meta.version !== undefined;
  meta.version = hasVersion ? Number(meta.version) : null;
  const hasSyncedAt = meta.syncedAt !== null && meta.syncedAt !== undefined;
  meta.syncedAt = hasSyncedAt ? Number(meta.syncedAt) : null;
  return meta;
};

export const writeIndexMeta = (db, entries) => {
  const stmt = db.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(entries)) stmt.run(key, String(value));
};

export const isCurrentIndexVersion = (meta) => meta.version === INDEX_VERSION;

const countIndexedFiles = (db) => Number(db.prepare('SELECT COUNT(*) AS c FROM files').get()?.c || 0);

// Wipes index rows (never team, audit or violation tables) when the stamp differs.
// Returns { reset: boolean, previousVersion, droppedFiles }.
export const ensureIndexVersion = (db) => {
  const preCheck = readIndexMeta(db);
  const isAlreadyCurrent = isCurrentIndexVersion(preCheck);
  if (isAlreadyCurrent) return { reset: false, previousVersion: preCheck.version, droppedFiles: 0 };
  db.exec('BEGIN IMMEDIATE;');
  try {
    const meta = readIndexMeta(db);
    const isCurrent = isCurrentIndexVersion(meta);
    if (isCurrent) {
      db.exec('COMMIT;');
      return { reset: false, previousVersion: meta.version, droppedFiles: 0 };
    }
    const droppedFiles = countIndexedFiles(db);
    for (const table of INDEX_ROW_TABLES) db.exec(`DELETE FROM ${table};`);
    db.exec("DELETE FROM index_meta WHERE key IN ('scope', 'syncedAt');");
    writeIndexMeta(db, { version: INDEX_VERSION });
    db.exec('COMMIT;');
    const hadRows = droppedFiles > 0;
    return { reset: hadRows, previousVersion: meta.version, droppedFiles };
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (rollbackErr) { debugNote.warn('version reset rollback', rollbackErr); }
    throw err;
  }
};

export const describeVersionReset = (reset) => {
  const previous = reset.previousVersion === null ? 'unversioned' : `v${reset.previousVersion}`;
  return `index rebuilt: ${previous} rows (${reset.droppedFiles} files) replaced by extractor v${INDEX_VERSION}`;
};
