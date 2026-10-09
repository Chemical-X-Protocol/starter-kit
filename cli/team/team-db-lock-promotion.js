/**
 * Chemical X Protocol: FIFO Lock Promotion, Waiter Hygiene & Expiration Cleanup
 * Every write here only changes the exact row it judged, so a concurrent acquire is never clobbered.
 */

import { postFeedEvent } from './team-db-feed.js';
import { isPidAlive } from './team-db-transaction.js';

export const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const WAITER_TTL_MS = 2 * DEFAULT_TTL_MS;

const hasTrackedPid = (pid) => typeof pid === 'number' && pid > 0;

export const isOwnerProcessDead = (row) => hasTrackedPid(row?.pid) && !isPidAlive(row.pid);

export const describeLease = (lease, now = Date.now()) => {
  const hasLease = Boolean(lease);
  if (!hasLease) return null;
  const expired = lease.expires_at <= now;
  const holderDead = isOwnerProcessDead(lease);
  return { ...lease, expired, holderDead, active: !expired && !holderDead };
};

const lastSeenAt = (waiter) => (waiter.last_seen_at > 0 ? waiter.last_seen_at : waiter.requested_at);

const isWaiterStale = (waiter, now) => lastSeenAt(waiter) <= now - WAITER_TTL_MS || isOwnerProcessDead(waiter);

export const expireStaleWaiters = (db, filePath, now = Date.now()) => {
  const waiting = db.prepare("SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting'").all(filePath);
  const stale = waiting.filter((waiter) => isWaiterStale(waiter, now));
  const markExpired = db.prepare("UPDATE file_lock_queue SET status = 'expired' WHERE id = ? AND status = 'waiting'");
  for (const waiter of stale) markExpired.run(waiter.id);
  return stale;
};

export const promoteNextWaiter = (db, filePath) => {
  const canPromote = Boolean(db) && Boolean(filePath);
  if (!canPromote) return null;

  const now = Date.now();
  expireStaleWaiters(db, filePath, now);
  const waiterQuery = "SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting' ORDER BY priority ASC, id ASC LIMIT 1";
  const waiter = db.prepare(waiterQuery).get(filePath);
  const hasWaiter = Boolean(waiter);
  if (!hasWaiter) return null;

  const expiresAt = now + DEFAULT_TTL_MS;
  const insertSql = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(file_path) DO NOTHING`;
  const purpose = waiter.purpose || 'Promoted from FIFO queue';
  const inserted = db.prepare(insertSql).run(filePath, waiter.agent_id, now, expiresAt, purpose, waiter.pid || 0);
  const isGranted = inserted.changes === 1;
  if (!isGranted) return null; // another agent already holds the file; the waiter keeps its place

  db.prepare("UPDATE file_lock_queue SET status = 'granted' WHERE id = ? AND status = 'waiting'").run(waiter.id);
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

const countPosition = (db, filePath, queueId) => {
  const posRow = db.prepare(`
    SELECT COUNT(*) as pos FROM file_lock_queue
    WHERE file_path = ? AND status = 'waiting' AND id <= ?
  `).get(filePath, queueId);
  return posRow?.pos || 1;
};

export const enqueueWaiter = (db, filePath, cleanId, existingLease, options = {}, now = Date.now()) => {
  expireStaleWaiters(db, filePath, now);
  const pid = hasTrackedPid(options.pid) ? options.pid : 0;
  const findSql = "SELECT * FROM file_lock_queue WHERE file_path = ? AND agent_id = ? AND status = 'waiting' ORDER BY id ASC LIMIT 1";
  const existingEntry = db.prepare(findSql).get(filePath, cleanId);
  const isRepoll = Boolean(existingEntry);

  let queueId = existingEntry?.id;
  if (isRepoll) {
    db.prepare('UPDATE file_lock_queue SET last_seen_at = ?, pid = CASE WHEN ? > 0 THEN ? ELSE pid END WHERE id = ?')
      .run(now, pid, pid, queueId);
  } else {
    const info = db.prepare(`
      INSERT INTO file_lock_queue (file_path, agent_id, requested_at, status, priority, purpose, pid, last_seen_at)
      VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?)
    `).run(filePath, cleanId, now, Number(options.priority || 2), options.purpose || '', pid, now);
    queueId = Number(info.lastInsertRowid);
  }

  const position = countPosition(db, filePath, queueId);
  if (!isRepoll) {
    postFeedEvent(db, {
      author_id: cleanId,
      event_type: 'lock_queued',
      file_path: filePath,
      message: `${cleanId} joined FIFO queue at position ${position} for ${filePath}`,
      metadata: { queueId, position, heldBy: existingLease.locked_by }
    });
  }

  return {
    granted: false,
    queued: true,
    requeued: isRepoll,
    queueId,
    position,
    currentHolder: existingLease.locked_by,
    expiresAt: existingLease.expires_at
  };
};

export const cleanExpiredLeases = (db, now = Date.now()) => {
  const hasDb = Boolean(db);
  if (!hasDb) return [];

  try {
    const candidates = db.prepare('SELECT * FROM file_leases WHERE expires_at <= ? OR pid > 0').all(now);
    const removeExactLease = db.prepare(
      'DELETE FROM file_leases WHERE file_path = ? AND locked_by = ? AND acquired_at = ? AND expires_at = ?'
    );
    const cleaned = [];
    for (const lease of candidates) {
      const state = describeLease(lease, now);
      const isActive = Boolean(state.active);
      if (isActive) continue;
      const removal = removeExactLease.run(lease.file_path, lease.locked_by, lease.acquired_at, lease.expires_at);
      const isRemovedHere = removal.changes === 1;
      if (!isRemovedHere) continue; // a concurrent writer replaced this lease; it is not ours to delete
      const reason = state.holderDead ? `Process #${lease.pid} terminated` : 'TTL expired';
      postFeedEvent(db, {
        author_id: '@system',
        event_type: 'lock_expired',
        file_path: lease.file_path,
        message: `Lease expired for ${lease.file_path} held by ${lease.locked_by} (${reason})`,
        metadata: { holder: lease.locked_by, expires_at: lease.expires_at, acquired_at: lease.acquired_at, purpose: lease.purpose || '', reason }
      });
      promoteNextWaiter(db, lease.file_path);
      cleaned.push(lease);
    }
    return cleaned;
  } catch (err) {
    const isNoSuchTable = err && String(err.message).includes('no such table');
    if (isNoSuchTable) return [];
    throw err;
  }
};
