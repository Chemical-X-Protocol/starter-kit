// Is a stored index row still true for the file on disk? (#2552)
// mtime + size decide only for a row whose file was last modified clearly before the row was
// synced. Any other row is racy (git's racily-clean rule): a same-size rewrite inside the same
// clock tick keeps mtime and size, so the content hash decides. RACY_SLACK_MS widens "the same
// tick" to cover coarse filesystem clocks (kernel jiffies, 2s FAT, network mounts).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { INDEX_VERSION } from './search-index-meta.js';

export const RACY_SLACK_MS = 2000;

export const hashContent = (content) => crypto.createHash('sha1').update(content).digest('hex');

const toNumberOrNull = (value) => {
  const isBlank = value === null || value === undefined;
  return isBlank ? null : Number(value);
};

// One `files` row (SELECT *) as the stamp the checks compare. Columns a pre-#2552 db lacks read as
// null, which makes the row racy with no hash: it is re-parsed once, then stamped.
export const toRowStamp = (row) => ({
  mtime: Number(row.mtime),
  size: Number(row.size),
  version: toNumberOrNull(row.extractor_version),
  contentHash: row.content_hash || null,
  syncedAt: toNumberOrNull(row.synced_at)
});

export const readRowStamp = (db, relPath) => {
  const row = db.prepare('SELECT * FROM files WHERE path = ?').get(relPath);
  return row ? toRowStamp(row) : null;
};

// A row synced at syncedAt is racy while the file's mtime is not clearly older than syncedAt.
export const isRacyStamp = (stamp, mtimeMs) => {
  const hasSyncedAt = Number.isFinite(stamp?.syncedAt) && stamp.syncedAt > 0;
  if (!hasSyncedAt) return true;
  return Math.floor(mtimeMs) + RACY_SLACK_MS >= stamp.syncedAt;
};

const hasSameStat = (stamp, stat) => stamp.mtime === Math.floor(stat.mtimeMs) && stamp.size === stat.size;

/**
 * Compares one row with its file. Returns { verdict, hashed }: 'fresh' (mtime and size match and
 * the row is not racy), 'racy-clean' (racy, but the content hash matches: the row is true and only
 * its synced_at needs a new stamp) or 'stale' (re-parse). Throws when the file cannot be stat'd.
 */
export const checkRowAgainstDisk = (stamp, fullPath) => {
  const stat = fs.statSync(fullPath);
  const isCurrentRow = Boolean(stamp) && stamp.version === INDEX_VERSION && hasSameStat(stamp, stat);
  if (!isCurrentRow) return { verdict: 'stale', hashed: false };
  const isRacy = isRacyStamp(stamp, stat.mtimeMs);
  if (!isRacy) return { verdict: 'fresh', hashed: false };
  const hasStoredHash = Boolean(stamp.contentHash);
  if (!hasStoredHash) return { verdict: 'stale', hashed: false };
  const isSameContent = hashContent(fs.readFileSync(fullPath, 'utf-8')) === stamp.contentHash;
  return { verdict: isSameContent ? 'racy-clean' : 'stale', hashed: true };
};
