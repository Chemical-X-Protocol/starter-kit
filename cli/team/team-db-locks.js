/**
 * Chemical X Protocol: FIFO File Lock Queue & Lease Manager
 * Prevents race collisions with deterministic queueing and reactive promotion
 */

import path from 'node:path';
import { postFeedEvent } from './team-db-feed.js';
import { DEFAULT_TTL_MS, cleanExpiredLeases, promoteNextWaiter, enqueueWaiter, describeLease } from './team-db-lock-promotion.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { resolveLeaseScope, toLeaseKey } from './lease-key.js';
import { findLapse, explainNotHolder } from './lease-lapse.js';
import { notifyHolderOfWaiter } from './lease-waiter-notice.js';
import { lockRoots } from './lease-roots.js';
import { openTeamDbReadOnly, closeQuietly, safeGet } from './team-db-readonly.js';

export { cleanExpiredLeases, promoteNextWaiter, describeLease } from './team-db-lock-promotion.js';

// Leases are keyed from the project root; a relative input resolves from options.cwd.
const leaseKeyFor = (db, filePath, options) => toLeaseKey(filePath, resolveLeaseScope(db, options));

const leaseInOtherDb = (lockRoot, absPath, cleanId, now) => {
  const key = path.relative(lockRoot, absPath);
  const isInside = key !== '' && !key.startsWith('..') && !path.isAbsolute(key);
  const db = isInside ? openTeamDbReadOnly(lockRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  try {
    const lease = describeLease(safeGet(db, 'SELECT * FROM file_leases WHERE file_path = ?', [key]), now);
    const isForeign = Boolean(lease?.active) && lease.locked_by !== cleanId;
    return isForeign ? { ...lease, lockRoot } : null;
  } finally {
    closeQuietly(db);
  }
};

/**
 * A live lease another handle holds on the same file in another team db (#2581). Until
 * `chemx team migrate` merges a package db, it and the coordination db both serve leases, keyed
 * from different roots; a lock taken from the root and one taken from the package must still
 * collide. Read-only and outside this db's transaction, so two requests racing through different
 * dbs in the same instant can both pass; the edit guard (edit-locks.js) still reads both dbs.
 */
export const findLeaseInOtherDb = (db, cleanPath, cleanId, options = {}) => {
  const scope = resolveLeaseScope(db, options);
  const absPath = path.resolve(scope.projectRoot, cleanPath);
  const now = options.now ?? Date.now();
  const others = lockRoots(scope.projectRoot, absPath).filter((lockRoot) => lockRoot !== scope.projectRoot);
  for (const lockRoot of others) {
    const lease = leaseInOtherDb(lockRoot, absPath, cleanId, now);
    if (lease) return lease;
  }
  return null;
};

const refuseForOtherDb = (lease, cleanPath) => ({
  granted: false,
  reason: 'held_in_other_db',
  heldBy: lease.locked_by,
  lease: { file_path: lease.file_path, locked_by: lease.locked_by, expires_at: Number(lease.expires_at), purpose: lease.purpose || '' },
  dbPath: path.join(lease.lockRoot, '.chemx', 'index.db'),
  message: `${cleanPath} is leased by ${lease.locked_by} in ${path.join(lease.lockRoot, '.chemx', 'index.db')} (an unmerged package db or the coordination db); not queued here. Wait with chemx wait --lock-free=<file>.`
});

const normalizeAgentId = (id) => {
  const hasId = Boolean(id);
  if (!hasId) return null;
  const isPrefixed = id.startsWith('@');
  return isPrefixed ? id : `@${id}`;
};

export const requestFileLock = (db, filePath, agentId, options = {}) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const hasAgent = Boolean(agentId);
  const canRequest = hasDb && hasPath && hasAgent;
  if (!canRequest) return { granted: false, reason: 'missing_args' };

  const cleanPath = leaseKeyFor(db, filePath, options);
  if (!cleanPath) return { granted: false, reason: 'path_traversal' };

  const cleanId = normalizeAgentId(agentId);
  const pid = typeof options.pid === 'number' ? options.pid : 0;
  const otherDbLease = findLeaseInOtherDb(db, cleanPath, cleanId, options);
  if (otherDbLease) return refuseForOtherDb(otherDbLease, cleanPath);

  return withImmediateTransaction(db, () => {
    cleanExpiredLeases(db);

    const existingLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(cleanPath);
    const now = Date.now();
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const expiresAt = now + ttlMs;
    const purpose = options.purpose || '';

    const isAvailable = !existingLease || existingLease.locked_by === cleanId;
    if (isAvailable) {
      // Read before the grant: a granted lease ends the lapse record's relevance.
      const lapse = existingLease ? null : findLapse(db, cleanPath, cleanId);
      const upsertSql = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          expires_at = excluded.expires_at,
          purpose = excluded.purpose,
          pid = excluded.pid`;
      db.prepare(upsertSql).run(cleanPath, cleanId, now, expiresAt, purpose, pid);

      postFeedEvent(db, {
        author_id: cleanId,
        event_type: 'lock_acquired',
        file_path: cleanPath,
        message: `${cleanId} acquired lock on ${cleanPath}`
      });

      const lapseNote = lapse ? { previousLapse: lapse } : {};
      return { granted: true, lease: { file_path: cleanPath, locked_by: cleanId, expires_at: expiresAt, pid }, ...lapseNote };
    }

    const queued = enqueueWaiter(db, cleanPath, cleanId, existingLease, options, now);
    const notice = notifyHolderOfWaiter(db, { queueId: queued.queueId, waiter: cleanId, lease: existingLease, options });
    return { ...queued, ...notice };
  });
};

export const releaseFileLock = (db, filePath, agentId, options = {}) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const hasAgent = Boolean(agentId);
  const canRelease = hasDb && hasPath && hasAgent;
  if (!canRelease) return { success: false, reason: 'missing_args' };

  const cleanPath = leaseKeyFor(db, filePath, options);
  if (!cleanPath) return { success: false, reason: 'path_traversal' };

  const cleanId = normalizeAgentId(agentId);

  return withImmediateTransaction(db, () => {
    cleanExpiredLeases(db);

    const existingLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(cleanPath);
    const isHolder = Boolean(existingLease) && existingLease.locked_by === cleanId;
    if (!isHolder) {
      const lapse = findLapse(db, cleanPath, cleanId);
      const message = explainNotHolder(cleanPath, lapse, existingLease, Date.now());
      const lapseNote = lapse ? { lapse } : {};
      return { success: false, reason: 'not_holder', message, heldBy: existingLease?.locked_by ?? null, ...lapseNote };
    }

    db.prepare('DELETE FROM file_leases WHERE file_path = ?').run(cleanPath);
    postFeedEvent(db, {
      author_id: cleanId,
      event_type: 'lock_released',
      file_path: cleanPath,
      message: `${cleanId} released lock on ${cleanPath}`
    });

    const next = promoteNextWaiter(db, cleanPath);
    const promotedWaiter = next ? next.waiter.agent_id : null;
    return { success: true, promotedWaiter };
  });
};

/**
 * Renew-on-edit and `lock renew`: extends the holder's own live lease to now + one TTL.
 * One UPDATE scoped to the holder's unexpired row; it never shortens a longer lease and
 * never touches another agent's lease, the queue or the feed.
 */
export const renewHeldLease = (db, leaseKey, agentId, options = {}) => {
  const now = options.now ?? Date.now();
  const expiresAt = now + (options.ttlMs || DEFAULT_TTL_MS);
  const cleanId = normalizeAgentId(agentId);
  const sql = 'UPDATE file_leases SET expires_at = MAX(expires_at, ?) WHERE file_path = ? AND locked_by = ? AND expires_at > ?';
  const res = db.prepare(sql).run(expiresAt, leaseKey, cleanId, now);
  return { renewed: Number(res.changes) > 0, expires_at: expiresAt };
};

const renewRefusal = (state, cleanId) => {
  const hasLease = Boolean(state);
  if (!hasLease) return 'no_lease';
  const isHolder = state.locked_by === cleanId;
  if (!isHolder) return 'not_holder';
  const isLive = Boolean(state.active);
  if (!isLive) return 'expired';
  return null;
};

export const renewFileLock = (db, filePath, agentId, options = {}) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const hasAgent = Boolean(agentId);
  const canRenew = hasDb && hasPath && hasAgent;
  if (!canRenew) return { renewed: false, reason: 'missing_args' };

  const cleanPath = leaseKeyFor(db, filePath, options);
  if (!cleanPath) return { renewed: false, reason: 'path_traversal' };

  const cleanId = normalizeAgentId(agentId);
  const state = describeLease(db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(cleanPath));
  const reason = renewRefusal(state, cleanId);
  const isRefused = Boolean(reason);
  if (isRefused) return { renewed: false, reason, file_path: cleanPath, lease: state };

  const res = renewHeldLease(db, cleanPath, cleanId, options);
  const expiresAt = Math.max(Number(state.expires_at), res.expires_at);
  return { renewed: res.renewed, file_path: cleanPath, locked_by: cleanId, expires_at: expiresAt, purpose: state.purpose || '' };
};

/** Live leases only (unexpired, holder alive), soonest expiry first. Read-only. */
export const listActiveLeases = (db, now = Date.now()) => {
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  const rows = db.prepare('SELECT * FROM file_leases ORDER BY expires_at ASC').all();
  return rows.map((row) => describeLease(row, now)).filter((lease) => lease.active);
};

export const getFileLockStatus = (db, filePath, options = {}) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const canGet = hasDb && hasPath;
  if (!canGet) return null;

  const cleanPath = leaseKeyFor(db, filePath, options);
  if (!cleanPath) return { lease: null, waiters: [], error: 'path_traversal' };

  // Read-only: an expired or orphaned lease is reported, never deleted, so a status
  // check cannot race a concurrent acquire. Acquire and release do the cleanup.
  const state = describeLease(db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(cleanPath));
  const isActive = Boolean(state?.active);
  const query = "SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting' ORDER BY priority ASC, id ASC";
  const waiters = db.prepare(query).all(cleanPath);
  return { lease: isActive ? state : null, expiredLease: isActive ? null : state, waiters };
};
