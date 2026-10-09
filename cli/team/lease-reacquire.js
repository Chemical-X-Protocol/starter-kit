/**
 * Chemical X Protocol: an edit by the former holder of a lapsed, untaken lease takes it back.
 * A lease lapses when its TTL passes with no chemx activity from the holder. If nobody else took the
 * file meanwhile, the holder's next edit of it re-acquires the lease for one TTL and reports that it
 * did, so a lapse is never silent. If someone else holds the file, the edit was already refused by
 * the foreign-lease check and this module is not reached.
 *
 * Two shapes of "lapsed and untaken": the expired row is still in file_leases, or cleanup deleted it
 * and the feed records the expiry (lease-lapse.js). Only the caller's own lapsed lease is retaken.
 */
import { lockRoots, leaseKeys } from './lease-roots.js';
import { openTeamDbReadOnly, openExistingTeamDb, closeQuietly, safeGet } from './team-db-readonly.js';
import { DEFAULT_TTL_MS } from './team-db-lock-promotion.js';
import { postFeedEvent } from './team-db-feed.js';
import { findLapse } from './lease-lapse.js';
import { resolveAgentId } from './agent-identity.js';

// The holder's lapse on one key, or null when there is nothing to take back.
export const lapseFor = (db, key, holder, now) => {
  const row = safeGet(db, 'SELECT * FROM file_leases WHERE file_path = ?', [key]);
  const hasRow = Boolean(row);
  if (!hasRow) {
    const lapse = findLapse(db, key, holder);
    return lapse ? { expiredAt: lapse.expiredAt, rowKept: false } : null;
  }
  const isOwnExpired = row.locked_by === holder && Number(row.expires_at) <= now;
  return isOwnExpired ? { expiredAt: Number(row.expires_at), rowKept: true } : null;
};

const KEPT_SQL = 'UPDATE file_leases SET acquired_at = ?, expires_at = ? WHERE file_path = ? AND locked_by = ? AND expires_at = ?';
const INSERT_SQL = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid)
  VALUES (?, ?, ?, ?, 'Re-acquired after lapse', 0) ON CONFLICT(file_path) DO NOTHING`;

// Each statement touches only the exact row it judged, so a concurrent grant to someone else wins.
const retake = (db, key, holder, lapse, now, ttlMs) => {
  const isRowKept = Boolean(lapse.rowKept);
  const kept = () => db.prepare(KEPT_SQL).run(now, now + ttlMs, key, holder, lapse.expiredAt);
  const inserted = () => db.prepare(INSERT_SQL).run(key, holder, now, now + ttlMs);
  const res = isRowKept ? kept() : inserted();
  return Number(res.changes) === 1;
};

const findLapseIn = (lockRoot, key, holder, now) => {
  const db = openTeamDbReadOnly(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  const lapse = lapseFor(db, key, holder, now);
  closeQuietly(db);
  return lapse;
};

const retakeIn = (lockRoot, key, holder, lapse, now, ttlMs) => {
  const db = openExistingTeamDb(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  try {
    const isRetaken = retake(db, key, holder, lapse, now, ttlMs);
    if (!isRetaken) return false;
    postFeedEvent(db, { author_id: holder, event_type: 'lock_acquired', file_path: key, message: `${holder} re-acquired lock on ${key} after it lapsed` });
    return true;
  } finally {
    closeQuietly(db);
  }
};

const reacquireOne = (root, absPath, holder, now, ttlMs) => {
  for (const lockRoot of lockRoots(root, absPath)) {
    const key = leaseKeys(lockRoot, absPath, root)[0];
    const lapse = key ? findLapseIn(lockRoot, key, holder, now) : null;
    const isRetaken = Boolean(lapse) && retakeIn(lockRoot, key, holder, lapse, now, ttlMs);
    if (isRetaken) return { file: absPath, key, lockRoot, lapsedAt: lapse.expiredAt, expiresAt: now + ttlMs };
  }
  return null;
};

/**
 * @param {string} root Workspace root applyEdits resolved paths against.
 * @param {string[]} absPaths Files the batch wrote.
 * @param {string} [agentId]
 * @param {{ now?: number, ttlMs?: number }} [options]
 * @returns {Array<{ file: string, key: string, lockRoot: string, lapsedAt: number, expiresAt: number }>} Leases retaken.
 */
export const reacquireLapsedAfterEdit = (root, absPaths, agentId, options = {}) => {
  try {
    const holder = resolveAgentId(agentId);
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    return absPaths.map((absPath) => reacquireOne(root, absPath, holder, now, ttlMs)).filter(Boolean);
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[lease-reacquire] skipped: ${err.message}\n`);
    return [];
  }
};
