import { toColumnar } from '../columnar.js';
import { registerAgent } from './team-db-agents.js';

export const normalizeHandle = (handle) => {
  if (!handle) return null;
  return handle.startsWith('@') ? handle : `@${handle}`;
};

export const sendDirectMessage = (db, params = {}) => {
  if (!db) return null;
  const author = normalizeHandle(params.author_id) || '@agent';
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
  let msgSql = 'SELECT id, timestamp, author_id, thread_id, task_id, read_at, message FROM agent_feed WHERE recipient_id = ?';
  if (options.since) {
    msgSql += ' AND id > ?';
    msgParams.push(Number(options.since));
  }
  msgSql += ' ORDER BY id DESC LIMIT ?';
  msgParams.push(limit);
  const messages = db.prepare(msgSql).all(...msgParams);

  const leases = db.prepare(`
    SELECT file_path, locked_by, expires_at, purpose
    FROM file_leases
    WHERE locked_by = ?
    ORDER BY expires_at ASC
  `).all(cleanId);

  const unreadRow = db.prepare(`
    SELECT COUNT(*) as count FROM agent_feed
    WHERE recipient_id = ? AND read_at IS NULL
  `).get(cleanId);
  const unreadCount = Number(unreadRow?.count || 0);

  if (options.markRead) {
    db.prepare(`
      UPDATE agent_feed SET read_at = ?
      WHERE recipient_id = ? AND read_at IS NULL
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
