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

export const queryFeed = (db, filter = {}) => {
  if (!db) return [];
  let query = 'SELECT * FROM agent_feed';
  const conditions = [];
  const params = [];

  if (filter.since_id) {
    conditions.push('id > ?');
    params.push(Number(filter.since_id));
  }
  if (filter.thread_id) {
    conditions.push('(thread_id = ? OR id = ?)');
    params.push(Number(filter.thread_id), Number(filter.thread_id));
  }
  if (filter.task_id) {
    conditions.push('task_id = ?');
    params.push(Number(filter.task_id));
  }
  if (filter.event_type) {
    conditions.push('event_type = ?');
    params.push(filter.event_type);
  }
  if (filter.agent_id) {
    const cleanId = formatHandle(filter.agent_id);
    conditions.push('(recipient_id IS NULL OR recipient_id = ? OR author_id = ?)');
    params.push(cleanId, cleanId);
  }

  const hasConditions = conditions.length > 0;
  if (hasConditions) query += ` WHERE ${conditions.join(' AND ')}`;
  const limit = Math.min(Number(filter.limit || 50), 200);
  query += ` ORDER BY id ASC LIMIT ${limit}`;

  return db.prepare(query).all(...params).map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata || '{}')
  }));
};
