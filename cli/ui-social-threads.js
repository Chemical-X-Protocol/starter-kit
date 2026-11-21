/**
 * Threads: GET/POST /api/threads/<postId> (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 *   getPatterns / postPatterns return [[regex, (match) => result]] for id paths; this module uses both.
 */
import { handlePostFeed } from './ui-handlers.js';

export const API_DOCS = [
  {
    path: '/api/threads/:id',
    about: 'GET: replies to feed post :id as {success, replies}, oldest first (feed rows whose thread_id is :id). POST {author, message}: adds a status_update reply with thread_id :id and answers {success, post}. {success:false, error} when the post is missing, the message is empty or the db is unavailable; the HTTP status is not guaranteed to reflect that.'
  }
];

const postExists = (db, id) => Boolean(db.prepare('SELECT 1 AS ok FROM agent_feed WHERE id = ?').get(id));

/** Replies to one post, oldest first; {success:false} when the feed table cannot be read. */
export const readReplies = (db, id) => {
  try {
    return { success: true, replies: db.prepare('SELECT * FROM agent_feed WHERE thread_id = ? ORDER BY id ASC').all(id) };
  } catch (err) {
    return { success: false, error: `Could not read replies to post ${id}: ${err.message}` };
  }
};

/** Inserts a reply through the same handler as POST /api/feed; rejects an empty message or an unknown post. */
export const addReply = (db, id, body = {}) => {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return { success: false, error: 'message is required.' };
  try {
    if (!postExists(db, id)) return { success: false, error: `No post with id ${id}.` };
    return handlePostFeed(db, { author: body.author, message, eventType: 'status_update', threadId: id });
  } catch (err) {
    return { success: false, error: `Could not add a reply to post ${id}: ${err.message}` };
  }
};

export const getRoutes = () => ({});

export const postRoutes = () => ({});

const ID_PATH = /^\/api\/threads\/(\d+)$/;
const dbMissing = { success: false, error: 'Database unavailable' };

export const getPatterns = (db) => [[ID_PATH, (m) => (db ? readReplies(db, Number(m[1])) : dbMissing)]];

export const postPatterns = (db, body) => [[ID_PATH, (m) => (db ? addReply(db, Number(m[1]), body) : dbMissing)]];
