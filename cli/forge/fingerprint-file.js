// Keeps the Forge ledger current between audits (design doc, INCREMENTAL PATH step 2): the patcher
// and writer call fingerprintFile after their search-index micro-sync, so an agent edit updates that
// file's pattern_units rows without a full audit. Heal (P6) calls it the same way.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb, getIndexDbState } from '../search-schema.js';
import { resolveIndexRoot } from '../search-root.js';
import { collectFileUnits } from './file-units.js';
import { createForgeSession, statOf } from './fingerprint-session.js';

/** A Forge session on the project's index db, or null when the db is missing or read-only. */
export const openForgeSession = (cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  const isWritable = Boolean(db) && !getIndexDbState(db).isReadOnly;
  if (!isWritable) return null;
  return createForgeSession(db, { root: resolveIndexRoot(cwd), ...options });
};

/**
 * Fingerprints one file of an open session from disk. Returns 'fingerprinted', 'unchanged' (same
 * sha1 and extractor version) or 'skipped' (excluded, or not a script or SFC).
 */
export const fingerprintInSession = (session, fullPath, stat = statOf(fullPath)) => {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const fingerprint = session.beginFile(fullPath, content, stat);
  if (fingerprint) {
    session.commitFile(fingerprint, collectFileUnits(fingerprint.relativePath, content));
    return 'fingerprinted';
  }
  return session.stampOf(fullPath) ? 'unchanged' : 'skipped';
};

/**
 * Re-fingerprints one file after a write (a deleted file loses its rows). Never throws.
 * Returns { status, path, rows } where status is fingerprinted, unchanged, skipped, removed,
 * unavailable (no writable index db) or failed.
 */
export const fingerprintFile = (targetPath, cwd = process.cwd(), options = {}) => {
  try {
    const session = openForgeSession(cwd, options);
    if (!session) return { status: 'unavailable', path: null, rows: 0 };
    const fullPath = path.resolve(cwd, targetPath);
    const relPath = session.relativeOf(fullPath);
    const isMissing = !fs.existsSync(fullPath);
    if (isMissing) session.forget(fullPath);
    const status = isMissing ? 'removed' : fingerprintInSession(session, fullPath);
    const summary = session.finish();
    return { status, path: relPath, rows: summary.rows };
  } catch (err) {
    return { status: 'failed', path: null, rows: 0, error: err instanceof Error ? err.message : String(err) };
  }
};
