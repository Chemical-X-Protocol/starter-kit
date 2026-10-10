// Forge fingerprint ledger in index.db (design doc, Data model and INCREMENTAL PATH). A changed file is
// replaced in one transaction: its old fps are read, its rows deleted (explicitly, so it holds with
// foreign_keys off too) and the new ones inserted; both fp sets are returned for the dirty set.
// Row reads are ordered (start_line, start, id); nothing here sorts with localeCompare.
import { withIndexTransaction } from '../search-index-write.js';
import { writeIndexMeta } from '../search-index-meta.js';
import { anchorWeight } from './anchors.js';
import { isInlineRequested, INLINE_VERSION_OFFSET } from './inline-mode.js';

// Bump when units, canonicalization, hashing, facets or the store floor change meaning: every file
// whose row carries another version is fingerprinted again.
// 5: alias inlining off by default (#2595). Opting in (CHEMX_FORGE_INLINE=1) adds INLINE_VERSION_OFFSET so
// the two modes never share ledger rows.
// 6: a ledger measured on the kit held a version-5 row whose unit_count differed from a fresh sync of the
// same content (45 against 46 for one file; cause not established), and a sync never repairs such a row.
// 7: canonicalization soundness fixes from the fuzzer (#2596): array elisions hashed, binder names kept in
// files with a direct eval or `with`, private member names apart at L2, line breaks kept in template
// expressions that may hold a `//` comment, and the opt-in inlining refuses write targets and typeof globals.
// 8: one-pass unit hashing (#2554, unit-hash.js): fp values change; which units share an fp, per level,
// does not (unit-hash.equivalence.spec.js).
const EXTRACTOR_BASE = 8;
export const FORGE_EXTRACTOR_VERSION = EXTRACTOR_BASE + (isInlineRequested() ? INLINE_VERSION_OFFSET : 0);

const SQL = {
  stamps: 'SELECT path, content_hash, mtime_ms, size, extractor_version, facet_key FROM pattern_files',
  oldFps: 'SELECT fp1, fp2, fp3, inner_fp1, inner_fp2, inner_fp3 FROM pattern_units WHERE file_path = ?',
  deleteUnits: 'DELETE FROM pattern_units WHERE file_path = ?',
  deleteFile: 'DELETE FROM pattern_files WHERE path = ?',
  upsertFile: `INSERT INTO pattern_files (path, content_hash, mtime_ms, size, lang, facet_key, extractor_version, unit_count, dropped_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET content_hash = excluded.content_hash, mtime_ms = excluded.mtime_ms, size = excluded.size,
      lang = excluded.lang, facet_key = excluded.facet_key, extractor_version = excluded.extractor_version,
      unit_count = excluded.unit_count, dropped_count = excluded.dropped_count, updated_at = excluded.updated_at`,
  touchFile: 'UPDATE pattern_files SET mtime_ms = ?, size = ? WHERE path = ?',
  facetFile: 'UPDATE pattern_files SET facet_key = ? WHERE path = ?',
  facetUnits: 'UPDATE pattern_units SET facet_key = ? WHERE file_path = ?',
  insertUnit: `INSERT INTO pattern_units (file_path, kind, block_id, ordinal, start, end, start_line, end_line, decl_name, is_export,
    mass, anchor_weight, anchors, fp1, fp2, fp3, inner_fp1, inner_fp2, inner_fp3, facet_key, is_spec, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  fileUnits: 'SELECT * FROM pattern_units WHERE file_path = ? ORDER BY start_line, start, id',
  countUnits: 'SELECT COUNT(*) AS c FROM pattern_units'
};

const STATEMENTS = new WeakMap();

const statementsFor = (db) => {
  const cached = STATEMENTS.get(db);
  if (cached) return cached;
  const prepared = Object.fromEntries(Object.entries(SQL).map(([name, sql]) => [name, db.prepare(sql)]));
  STATEMENTS.set(db, prepared);
  return prepared;
};

// Kind-specific extras that have no column of their own.
const META_OF = {
  fn: (unit) => ({ paramNames: unit.paramNames ?? [], signature: unit.signature ?? null }),
  tmpl: (unit) => ({ tag: unit.tag, nodeId: unit.nodeId }),
  stmt: () => null,
  expr: () => null
};

const rowOf = (unit) => {
  const meta = META_OF[unit.kind](unit);
  const isTemplate = unit.kind === 'tmpl';
  return {
    blockId: isTemplate ? (unit.parentId ?? 0) : (unit.blockId ?? null),
    ordinal: unit.ordinal ?? null,
    meta: meta ? JSON.stringify(meta) : null
  };
};

const insertUnits = (s, record) => {
  for (const unit of record.units) {
    const row = rowOf(unit);
    s.insertUnit.run(
      record.path, unit.kind, row.blockId, row.ordinal, unit.startOffset ?? null, unit.endOffset ?? null,
      unit.start ?? 1, unit.end ?? unit.start ?? 1, unit.declName ?? null, null,
      unit.mass, anchorWeight(unit.anchors), JSON.stringify(unit.anchors), unit.fp1, unit.fp2, unit.fp3,
      unit.innerFp1 ?? null, unit.innerFp2 ?? null, unit.innerFp3 ?? null, record.facet.key, record.facet.spec ? 1 : 0, row.meta
    );
  }
};

// A unit (camelCase) or a row (snake_case): its own fps plus any folded expression fps (unit-floor.js).
const fpsOf = (rows) => rows.flatMap((row) => [
  row.fp1, row.fp2, row.fp3,
  row.innerFp1 ?? row.inner_fp1, row.innerFp2 ?? row.inner_fp2, row.innerFp3 ?? row.inner_fp3
].filter(Boolean));

/** Map<path, { contentHash, mtimeMs, size, extractorVersion, facetKey }> of every ledger file. */
export const readFileStamps = (db) => {
  const stamps = new Map();
  for (const row of statementsFor(db).stamps.all()) {
    stamps.set(row.path, {
      contentHash: row.content_hash, mtimeMs: Number(row.mtime_ms), size: Number(row.size),
      extractorVersion: Number(row.extractor_version), facetKey: row.facet_key
    });
  }
  return stamps;
};

/** True when a stored stamp still describes this content under the current extractor. */
export const isStampCurrent = (stamp, contentHash) => {
  const isSameContent = stamp?.contentHash === contentHash;
  return isSameContent && stamp.extractorVersion === FORGE_EXTRACTOR_VERSION;
};

/**
 * Replaces one file's units. record: { path, contentHash, mtimeMs, size, facet, units, droppedCount }.
 * Returns { previousFps, nextFps } (fp1, fp2 and fp3 of every old and new row).
 */
export const replaceFileUnits = (db, record) => withIndexTransaction(db, () => {
  const s = statementsFor(db);
  const previousFps = fpsOf(s.oldFps.all(record.path));
  s.deleteUnits.run(record.path);
  s.upsertFile.run(
    record.path, record.contentHash, Math.trunc(record.mtimeMs ?? 0), record.size ?? 0, record.facet.lang, record.facet.key,
    FORGE_EXTRACTOR_VERSION, record.units.length, record.droppedCount ?? 0, Date.now()
  );
  insertUnits(s, record);
  return { previousFps, nextFps: fpsOf(record.units) };
});

/** Records a new mtime/size for a file whose content hash did not change. */
export const touchFileStamp = (db, filePath, { mtimeMs, size }) => {
  statementsFor(db).touchFile.run(Math.trunc(mtimeMs), size, filePath);
};

/**
 * Moves an unchanged file's rows to another facet (its package root moved: a package.json was added or
 * removed). Returns the fps it holds, which are dirty for both the old and the new facet.
 */
export const updateFileFacet = (db, filePath, facetKey) => withIndexTransaction(db, () => {
  const s = statementsFor(db);
  const fps = fpsOf(s.oldFps.all(filePath));
  s.facetFile.run(facetKey, filePath);
  s.facetUnits.run(facetKey, filePath);
  return fps;
});

/** Deletes the ledger rows of these files. Returns the fps they held. */
export const removeLedgerFiles = (db, filePaths) => withIndexTransaction(db, () => {
  const s = statementsFor(db);
  const removedFps = [];
  for (const filePath of filePaths) {
    removedFps.push(...fpsOf(s.oldFps.all(filePath)));
    s.deleteUnits.run(filePath);
    s.deleteFile.run(filePath);
  }
  return removedFps;
});

export const listFileUnits = (db, filePath) => statementsFor(db).fileUnits.all(filePath);

export const countLedgerUnits = (db) => Number(statementsFor(db).countUnits.get()?.c ?? 0);

export const stampExtractorVersion = (db) => writeIndexMeta(db, { pattern_extractor_version: FORGE_EXTRACTOR_VERSION });
