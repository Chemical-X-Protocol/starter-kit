/**
 * Chemical X Protocol: Swarm Activity Feed & Social Bus
 * Event stream, threads, and @mentions for agent coordination
 */

const formatHandle = (handle, fallback = null) => {
  const hasHandle = Boolean(handle);
  if (!hasHandle) return fallback;
  const isPrefixed = handle.startsWith('@');
  if (isPrefixed) return handle;
  return `@${handle}`;
};

export const postFeedEvent = (db, eventData = {}) => {
  const hasDb = Boolean(db);
  const hasMessage = Boolean(eventData?.message);
  const canPost = hasDb && hasMessage;
  if (!canPost) return null;

  const authorId = formatHandle(eventData.author_id, '@system');
  const recipientId = formatHandle(eventData.recipient_id, null);

  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO agent_feed (
      timestamp, author_id, recipient_id, thread_id,
      task_id, file_path, event_type, message, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    now,
    authorId,
    recipientId,
    eventData.thread_id || null,
    eventData.task_id || null,
    eventData.file_path || null,
    eventData.event_type || 'broadcast',
    eventData.message,
    JSON.stringify(eventData.metadata || {})
  );

  const row = db.prepare('SELECT * FROM agent_feed WHERE id = ?').get(info.lastInsertRowid);
  return { ...row, metadata: JSON.parse(row.metadata || '{}') };
};

// Rows whose metadata carries $.archived = 1 stay in the table (cleanup archives, never deletes)
// but drop out of feed, status and mailbox listings.
export const NOT_ARCHIVED_SQL = "COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.archived'), 0) != 1";

const parseRow = (r) => ({ ...r, metadata: JSON.parse(r.metadata || '{}') });

// With since_id the feed reads forward in id order (a cursor). Without it, it returns the newest
// `limit` rows, still in chronological order, so status cards show recent activity, not the oldest rows.
export const queryFeed = (db, filter = {}) => {
  if (!db) return [];
  let query = 'SELECT * FROM agent_feed';
  const conditions = [NOT_ARCHIVED_SQL];
  const params = [];
  const hasCursor = Boolean(filter.since_id);

  if (hasCursor) {
    conditions.push('id > ?');
    params.push(Number(filter.since_id));
  }
  const hasThread = Boolean(filter.thread_id);
  if (hasThread) {
    conditions.push('(thread_id = ? OR id = ?)');
    params.push(Number(filter.thread_id), Number(filter.thread_id));
  }
  const hasTask = Boolean(filter.task_id);
  if (hasTask) {
    conditions.push('task_id = ?');
    params.push(Number(filter.task_id));
  }
  const hasEventType = Boolean(filter.event_type);
  if (hasEventType) {
    conditions.push('event_type = ?');
    params.push(filter.event_type);
  }
  const hasAgent = Boolean(filter.agent_id);
  if (hasAgent) {
    const cleanId = formatHandle(filter.agent_id);
    conditions.push('(recipient_id IS NULL OR recipient_id = ? OR author_id = ?)');
    params.push(cleanId, cleanId);
  }

  query += ` WHERE ${conditions.join(' AND ')}`;
  const limit = Math.min(Number(filter.limit || 50), 200);
  const direction = hasCursor ? 'ASC' : 'DESC';
  query += ` ORDER BY id ${direction} LIMIT ${limit}`;

  const rows = db.prepare(query).all(...params).map(parseRow);
  if (hasCursor) return rows;
  return rows.reverse();
};
