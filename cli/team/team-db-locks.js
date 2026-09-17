/**
 * Chemical X Protocol: FIFO File Lock Queue & Lease Manager
 * Prevents race collisions with deterministic queueing and reactive promotion
 */

import { postFeedEvent } from './team-db-feed.js';
import { DEFAULT_TTL_MS, cleanExpiredLeases, promoteNextWaiter, enqueueWaiter } from './team-db-lock-promotion.js';

export { cleanExpiredLeases, promoteNextWaiter } from './team-db-lock-promotion.js';

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

  const cleanId = normalizeAgentId(agentId);
  cleanExpiredLeases(db);

  const existingLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(filePath);
  const now = Date.now();
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const expiresAt = now + ttlMs;
  const purpose = options.purpose || '';

  const isAvailable = !existingLease || existingLease.locked_by === cleanId;
  if (isAvailable) {
    const upsertSql = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET expires_at = excluded.expires_at, purpose = excluded.purpose`;
    db.prepare(upsertSql).run(filePath, cleanId, now, expiresAt, purpose);

    postFeedEvent(db, {
      author_id: cleanId,
      event_type: 'lock_acquired',
      file_path: filePath,
      message: `${cleanId} acquired lock on ${filePath}`
    });

    return { granted: true, lease: { file_path: filePath, locked_by: cleanId, expires_at: expiresAt } };
  }

  return enqueueWaiter(db, filePath, cleanId, existingLease, options, now);
};

export const releaseFileLock = (db, filePath, agentId) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const hasAgent = Boolean(agentId);
  const canRelease = hasDb && hasPath && hasAgent;
  if (!canRelease) return { success: false, reason: 'missing_args' };

  const cleanId = normalizeAgentId(agentId);
  cleanExpiredLeases(db);

  const existingLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(filePath);
  const isHolder = Boolean(existingLease) && existingLease.locked_by === cleanId;
  if (!isHolder) {
    return { success: false, reason: 'not_holder' };
  }

  db.prepare('DELETE FROM file_leases WHERE file_path = ?').run(filePath);
  postFeedEvent(db, {
    author_id: cleanId,
    event_type: 'lock_released',
    file_path: filePath,
    message: `${cleanId} released lock on ${filePath}`
  });

  const next = promoteNextWaiter(db, filePath);
  const promotedWaiter = next ? next.waiter.agent_id : null;
  return { success: true, promotedWaiter };
};

export const getFileLockStatus = (db, filePath) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const canGet = hasDb && hasPath;
  if (!canGet) return null;

  cleanExpiredLeases(db);
  const lease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(filePath);
  const query = "SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting' ORDER BY priority ASC, id ASC";
  const waiters = db.prepare(query).all(filePath);
  return { lease: lease || null, waiters };
};
