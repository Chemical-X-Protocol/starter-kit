/**
 * Chemical X Protocol: agent profiles v1 (no schema change).
 * A profile is derived from agents, agent_tasks, agent_feed, file_leases and agent_memory_log; any
 * missing table reads as empty. Lists are { count, items } with items capped at `limit`.
 * Reads work on a read-only handle (team-db-readonly.js); only recordHandoff writes.
 */

import { describeLease } from './team-db-lock-promotion.js';
import { postFeedEvent } from './team-db-feed.js';
import { safeAll, safeGet } from './team-db-readonly.js';

export { formatProfileBrief, PROFILE_BRIEF_MAX_CHARS } from './team-profile-format.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;
export const HANDOFF_MAX_CHARS = 2000;
const FEED_COLUMNS = 'id, timestamp, author_id, recipient_id, event_type, task_id, file_path, message';
const TASK_COLUMNS = 'id, title, status, priority, target_path';

export const toAgentHandle = (raw) => {
  const text = String(raw ?? '').trim();
  const isEmpty = text === '';
  if (isEmpty) return null;
  const isPrefixed = text.startsWith('@');
  return isPrefixed ? text : `@${text}`;
};

const clampLimit = (limit) => {
  const value = Number(limit);
  const isValid = Number.isInteger(value) && value > 0;
  return isValid ? Math.min(value, MAX_LIMIT) : DEFAULT_LIMIT;
};

const toFeedItem = (row) => ({
  id: row.id,
  at: Number(row.timestamp),
  type: row.event_type,
  from: row.author_id,
  taskId: row.task_id ?? null,
  file: row.file_path ?? null,
  message: row.message,
});

const toTask = (row) => ({ id: row.id, title: row.title, status: row.status, priority: row.priority, target: row.target_path ?? null });

const toLock = (lease) => ({ file: lease.file_path, holder: lease.locked_by, expiresAt: lease.expires_at, purpose: lease.purpose || '' });

const countOf = (db, sql, params) => Number(safeGet(db, sql, params)?.count ?? 0);

const presence = (db, handle) => {
  const agent = safeGet(db, 'SELECT heartbeat, status, role FROM agents WHERE id = ?', [handle]);
  const feed = safeGet(db, 'SELECT MIN(timestamp) AS first, MAX(timestamp) AS last FROM agent_feed WHERE author_id = ?', [handle]);
  const memory = safeGet(db, 'SELECT MIN(injected_at) AS first, MAX(injected_at) AS last, COUNT(*) AS count FROM agent_memory_log WHERE agent_id = ?', [handle]);
  const stamps = [agent?.heartbeat, feed?.first, feed?.last, memory?.first, memory?.last]
    .map(Number)
    .filter((stamp) => Number.isFinite(stamp) && stamp > 0);
  const hasStamps = stamps.length > 0;
  return {
    firstSeen: hasStamps ? Math.min(...stamps) : null,
    lastSeen: hasStamps ? Math.max(...stamps) : null,
    status: agent?.status ?? null,
    role: agent?.role ?? null,
    memoryInjections: Number(memory?.count ?? 0),
  };
};

const tasksIn = (db, handle, statuses, limit) => {
  const placeholders = statuses.map(() => '?').join(', ');
  const where = `assigned_agent_id = ? AND status IN (${placeholders})`;
  const params = [handle, ...statuses];
  const count = countOf(db, `SELECT COUNT(*) AS count FROM agent_tasks WHERE ${where}`, params);
  const rows = safeAll(db, `SELECT ${TASK_COLUMNS} FROM agent_tasks WHERE ${where} ORDER BY priority ASC, id ASC LIMIT ?`, [...params, limit]);
  return { count, items: rows.map(toTask) };
};

/** Active leases only: unexpired with a live (or untracked) holder process, per describeLease. */
export const listLiveLocks = (db, now = Date.now()) => safeAll(db, 'SELECT file_path, locked_by, expires_at, purpose, pid FROM file_leases ORDER BY expires_at ASC')
  .map((lease) => describeLease({ ...lease, expires_at: Number(lease.expires_at), pid: Number(lease.pid) }, now))
  .filter((lease) => lease.active)
  .map(toLock);

const toList = (items, limit) => ({ count: items.length, items: items.slice(0, limit) });

const unreadDms = (db, handle, limit) => {
  const where = 'recipient_id = ? AND read_at IS NULL';
  const count = countOf(db, `SELECT COUNT(*) AS count FROM agent_feed WHERE ${where}`, [handle]);
  const rows = safeAll(db, `SELECT ${FEED_COLUMNS} FROM agent_feed WHERE ${where} ORDER BY id DESC LIMIT ?`, [handle, limit]);
  return { count, items: rows.map(toFeedItem) };
};

const authoredEvents = (db, handle, eventType, limit) => {
  const where = 'author_id = ? AND event_type = ?';
  const count = countOf(db, `SELECT COUNT(*) AS count FROM agent_feed WHERE ${where}`, [handle, eventType]);
  const rows = safeAll(db, `SELECT ${FEED_COLUMNS} FROM agent_feed WHERE ${where} ORDER BY id DESC LIMIT ?`, [handle, eventType, limit]);
  return { count, items: rows.map(toFeedItem) };
};

const recentActivity = (db, handle, limit) => {
  const byType = safeAll(db, 'SELECT event_type AS type, COUNT(*) AS count FROM agent_feed WHERE author_id = ? GROUP BY event_type ORDER BY count DESC, type ASC', [handle])
    .map((row) => ({ type: row.type, count: Number(row.count) }));
  const total = byType.reduce((sum, row) => sum + row.count, 0);
  const rows = safeAll(db, `SELECT ${FEED_COLUMNS} FROM agent_feed WHERE author_id = ? ORDER BY id DESC LIMIT ?`, [handle, limit]);
  return { total, byType, items: rows.map(toFeedItem) };
};

/** Latest handoff note: by `author` when given, else by anyone. */
export const latestHandoff = (db, author = null) => {
  const hasAuthor = Boolean(author);
  const row = hasAuthor
    ? safeGet(db, `SELECT ${FEED_COLUMNS} FROM agent_feed WHERE event_type = 'handoff' AND author_id = ? ORDER BY id DESC LIMIT 1`, [author])
    : safeGet(db, `SELECT ${FEED_COLUMNS} FROM agent_feed WHERE event_type = 'handoff' ORDER BY id DESC LIMIT 1`);
  const hasRow = Boolean(row);
  return hasRow ? toFeedItem(row) : null;
};

export const getAgentProfile = (db, handle, { limit, now = Date.now() } = {}) => {
  const agentId = toAgentHandle(handle);
  const canRead = Boolean(db) && Boolean(agentId);
  if (!canRead) return null;
  const cap = clampLimit(limit);
  const myLocks = listLiveLocks(db, now).filter((lock) => lock.holder === agentId);
  return {
    handle: agentId,
    ...presence(db, agentId),
    claims: tasksIn(db, agentId, ['in_progress', 'blocked'], cap),
    queuedForMe: tasksIn(db, agentId, ['queued'], cap),
    liveLocks: toList(myLocks, cap),
    unreadDms: unreadDms(db, agentId, cap),
    recentDecisions: authoredEvents(db, agentId, 'decision', cap),
    latestHandoff: latestHandoff(db, agentId),
    recentActivity: recentActivity(db, agentId, cap),
  };
};

/** Posts a handoff note (agent_feed event_type 'handoff'); needs a writable db. */
export const recordHandoff = (db, handle, summary, { taskId = null } = {}) => {
  const author = toAgentHandle(handle);
  const text = String(summary ?? '').trim();
  const canRecord = Boolean(db) && Boolean(author) && text !== '';
  if (!canRecord) return null;
  const isClipped = text.length > HANDOFF_MAX_CHARS;
  const message = isClipped ? `${text.slice(0, HANDOFF_MAX_CHARS - 3)}...` : text;
  return postFeedEvent(db, { author_id: author, event_type: 'handoff', task_id: taskId, message, metadata: { kind: 'handoff', clipped: isClipped } });
};
