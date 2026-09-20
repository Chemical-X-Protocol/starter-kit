/**
 * Chemical X Protocol: Forum Topics & Feature Discussions Data Engine
 */
import { formatTokenStamp, resolveAgentMeta } from './ui-forum-data.js';

export const getForumTopics = (db, categoryId = null) => {
  if (!db) return [];
  const hasCat = Boolean(categoryId && categoryId !== 'all');
  const sql = hasCat
    ? 'SELECT * FROM forum_topics WHERE category_id = ? ORDER BY pinned DESC, updated_at DESC'
    : 'SELECT * FROM forum_topics ORDER BY pinned DESC, updated_at DESC';
  const rows = hasCat ? db.prepare(sql).all(categoryId) : db.prepare(sql).all();

  return rows.map((t) => {
    const replies = db.prepare('SELECT COUNT(*) as c FROM agent_feed WHERE thread_id = ?').get(t.id)?.c || 0;
    const last = db.prepare('SELECT author_id, timestamp FROM agent_feed WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
    return {
      id: t.id,
      categoryId: t.category_id,
      title: t.title,
      featureTag: t.feature_tag || 'feature',
      authorId: t.author_id,
      createdAt: Number(t.created_at),
      updatedAt: Number(t.updated_at),
      pinned: Boolean(t.pinned),
      repliesCount: replies,
      lastPostAuthor: last?.author_id || t.author_id,
      lastPostTimestamp: Number(last?.timestamp || t.updated_at)
    };
  });
};

export const getTopicPosts = (db, topicId) => {
  if (!db || !topicId) return [];
  const rows = db.prepare('SELECT * FROM agent_feed WHERE thread_id = ? ORDER BY id ASC').all(topicId) || [];
  return rows.map((f) => ({
    id: f.id,
    author: f.author_id,
    eventType: f.event_type,
    message: f.message,
    timestamp: Number(f.timestamp),
    threadId: f.thread_id,
    tokenStamp: formatTokenStamp(f.message?.length || 50),
    authorMeta: resolveAgentMeta({ id: f.author_id })
  }));
};

export const createForumTopic = (db, payload = {}) => {
  const { categoryId = 'general', title, featureTag = 'feature', authorId = '@user', message = '' } = payload;
  if (!db || !title?.trim()) return null;
  const now = Date.now();
  const res = db.prepare(`
    INSERT INTO forum_topics (category_id, title, feature_tag, author_id, created_at, updated_at, pinned)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(categoryId, title.trim(), featureTag.trim(), authorId, now, now);
  const topicId = Number(res.lastInsertRowid);

  if (message && message.trim()) {
    db.prepare(`
      INSERT INTO agent_feed (timestamp, author_id, event_type, message, thread_id, metadata)
      VALUES (?, ?, 'broadcast', ?, ?, '{}')
    `).run(now, authorId, message.trim(), topicId);
  }
  return { id: topicId, categoryId, title: title.trim(), featureTag: featureTag.trim(), authorId };
};
