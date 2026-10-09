import { toColumnar } from '../columnar.js';
import { registerAgent } from './team-db-agents.js';
import { NOT_ARCHIVED_SQL } from './team-db-feed.js';
import { describeLease } from './team-db-lock-promotion.js';
import { resolveAgentId } from './agent-identity.js';

export const normalizeHandle = (handle) => {
  if (!handle) return null;
  return handle.startsWith('@') ? handle : `@${handle}`;
};

export const sendDirectMessage = (db, params = {}) => {
  if (!db) return null;
  const author = resolveAgentId(params.author_id);
  const recipient = normalizeHandle(params.recipient_id);
  if (!recipient) throw new Error('recipient_id is required');
  registerAgent(db, { id: author, role: 'contributor' });

  const now = Date.now();
  const sql = `
    INSERT INTO agent_feed (
      timestamp, author_id, recipient_id, thread_id,
      task_id, file_path, event_type, message, metadata
    ) VALUES (?, ?, ?, ?, ?, NULL, 'dm', ?, ?)
  `;
  const info = db.prepare(sql).run(
    now,
    author,
    recipient,
    params.thread_id || null,
    params.task_id || null,
    params.message || '',
    JSON.stringify(params.metadata || {})
  );
  const row = db.prepare('SELECT * FROM agent_feed WHERE id = ?').get(info.lastInsertRowid);
  return { ...row, metadata: JSON.parse(row.metadata || '{}') };
};

export const getAgentMailbox = (db, agentId, options = {}) => {
  if (!db) return null;
  const cleanId = normalizeHandle(agentId);
  if (!cleanId) return null;

  const tasks = db.prepare(`
    SELECT id, title, tier, status, priority, target_path
    FROM agent_tasks
    WHERE assigned_agent_id = ? AND status IN ('in_progress', 'queued', 'blocked')
    ORDER BY priority ASC, id ASC
  `).all(cleanId);

  const limit = Math.min(Number(options.limit || 50), 200);
  const msgParams = [cleanId];
  let msgSql = `SELECT id, timestamp, author_id, thread_id, task_id, read_at, message FROM agent_feed WHERE recipient_id = ? AND ${NOT_ARCHIVED_SQL}`;
  const hasSince = Boolean(options.since);
  if (hasSince) {
    msgSql += ' AND id > ?';
    msgParams.push(Number(options.since));
  }
  msgSql += ' ORDER BY id DESC LIMIT ?';
  msgParams.push(limit);
  const messages = db.prepare(msgSql).all(...msgParams);

  // Expired leases and leases whose holder process is dead are not held any more; listing them
  // would tell the agent it still owns files it lost.
  const leases = db.prepare(`
    SELECT file_path, locked_by, expires_at, purpose, pid
    FROM file_leases
    WHERE locked_by = ?
    ORDER BY expires_at ASC
  `).all(cleanId).map((lease) => describeLease(lease)).filter((lease) => lease.active);

  const unreadRow = db.prepare(`
    SELECT COUNT(*) as count FROM agent_feed
    WHERE recipient_id = ? AND read_at IS NULL AND ${NOT_ARCHIVED_SQL}
  `).get(cleanId);
  const unreadCount = Number(unreadRow?.count || 0);

  const shouldMarkRead = Boolean(options.markRead);
  if (shouldMarkRead) {
    db.prepare(`
      UPDATE agent_feed SET read_at = ?
      WHERE recipient_id = ? AND read_at IS NULL AND ${NOT_ARCHIVED_SQL}
    `).run(Date.now(), cleanId);
  }

  return {
    agentId: cleanId,
    unreadCount,
    tasks: toColumnar(tasks, ['id', 'title', 'tier', 'status', 'priority', 'target_path']),
    messages: toColumnar(messages, ['id', 'timestamp', 'author_id', 'thread_id', 'task_id', 'read_at', 'message']),
    leases: toColumnar(leases, ['file_path', 'expires_at', 'purpose'])
  };
};
