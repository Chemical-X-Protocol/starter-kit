/**
 * Chemical X Protocol: FIFO File Lock Queue & Lease Manager
 * Prevents race collisions with deterministic queueing and reactive promotion
 */

import { postFeedEvent } from './team-db-feed.js';
import { DEFAULT_TTL_MS, cleanExpiredLeases, promoteNextWaiter, enqueueWaiter, describeLease } from './team-db-lock-promotion.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { resolveLeaseScope, toLeaseKey } from './lease-key.js';

export { cleanExpiredLeases, promoteNextWaiter, describeLease } from './team-db-lock-promotion.js';

// Leases are keyed from the project root; a relative input resolves from options.cwd.
const leaseKeyFor = (db, filePath, options) => toLeaseKey(filePath, resolveLeaseScope(db, options));

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

  return withImmediateTransaction(db, () => {
    cleanExpiredLeases(db);

    const existingLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(cleanPath);
    const now = Date.now();
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const expiresAt = now + ttlMs;
    const purpose = options.purpose || '';

    const isAvailable = !existingLease || existingLease.locked_by === cleanId;
    if (isAvailable) {
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

      return { granted: true, lease: { file_path: cleanPath, locked_by: cleanId, expires_at: expiresAt, pid } };
    }

    return enqueueWaiter(db, cleanPath, cleanId, existingLease, options, now);
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
      return { success: false, reason: 'not_holder' };
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
