/**
 * Chemical X Protocol: FIFO Lock Promotion & Expiration Cleanup
 */

import { postFeedEvent } from './team-db-feed.js';

export const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const promoteNextWaiter = (db, filePath) => {
  const hasDb = Boolean(db);
  const hasPath = Boolean(filePath);
  const canPromote = hasDb && hasPath;
  if (!canPromote) return null;

  const waiterQuery = "SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting' ORDER BY priority ASC, id ASC LIMIT 1";
  const waiter = db.prepare(waiterQuery).get(filePath);

  const hasWaiter = Boolean(waiter);
  if (!hasWaiter) return null;

  const now = Date.now();
  const expiresAt = now + DEFAULT_TTL_MS;
  db.prepare("UPDATE file_lock_queue SET status = 'granted' WHERE id = ?").run(waiter.id);

  const upsertSql = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET locked_by = excluded.locked_by, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at, purpose = excluded.purpose`;
  db.prepare(upsertSql).run(filePath, waiter.agent_id, now, expiresAt, waiter.purpose || 'Promoted from FIFO queue');

  postFeedEvent(db, {
    author_id: '@system',
    recipient_id: waiter.agent_id,
    event_type: 'lock_granted',
    file_path: filePath,
    message: `File lock granted to ${waiter.agent_id} for ${filePath} from FIFO queue`,
    metadata: { queueId: waiter.id, expiresAt }
  });

  return { waiter, expiresAt };
};

export const enqueueWaiter = (db, filePath, cleanId, existingLease, options = {}, now = Date.now()) => {
  const priority = Number(options.priority || 2);
  const purpose = options.purpose || '';
  const info = db.prepare(`
    INSERT INTO file_lock_queue (file_path, agent_id, requested_at, status, priority, purpose)
    VALUES (?, ?, ?, 'waiting', ?, ?)
  `).run(filePath, cleanId, now, priority, purpose);

  const posRow = db.prepare(`
    SELECT COUNT(*) as pos FROM file_lock_queue
    WHERE file_path = ? AND status = 'waiting' AND id <= ?
  `).get(filePath, info.lastInsertRowid);
  const position = posRow?.pos || 1;

  postFeedEvent(db, {
    author_id: cleanId,
    event_type: 'lock_queued',
    file_path: filePath,
    message: `${cleanId} joined FIFO queue at position ${position} for ${filePath}`,
    metadata: { queueId: info.lastInsertRowid, position, heldBy: existingLease.locked_by }
  });

  return {
    granted: false,
    queued: true,
    queueId: info.lastInsertRowid,
    position,
    currentHolder: existingLease.locked_by,
    expiresAt: existingLease.expires_at
  };
};

export const cleanExpiredLeases = (db) => {
  const hasDb = Boolean(db);
  if (!hasDb) return [];

  const now = Date.now();
  try {
    const expired = db.prepare('SELECT * FROM file_leases WHERE expires_at <= ?').all(now);
    for (const lease of expired) {
      db.prepare('DELETE FROM file_leases WHERE file_path = ?').run(lease.file_path);
      postFeedEvent(db, {
        author_id: '@system',
        event_type: 'lock_expired',
        file_path: lease.file_path,
        message: `Lease expired for ${lease.file_path} held by ${lease.locked_by}`
      });
      promoteNextWaiter(db, lease.file_path);
    }
    return expired;
  } catch {
    return [];
  }
};
