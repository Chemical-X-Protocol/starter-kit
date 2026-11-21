/**
 * Notifications: GET /api/notifications?handle=&since= (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 * Read state is the client's: the last-seen id travels back as since. This module stores nothing.
 */
import { NOT_ARCHIVED_SQL } from './team/team-db-feed.js';

const SCAN_LIMIT = 200;
const ITEM_LIMIT = 50;
const MESSAGE_CHARS = 200;

export const normalizeHandle = (raw) => {
  const text = String(raw || '').trim();
  const isEmpty = text === '' || text === '@';
  if (isEmpty) return '';
  return text.startsWith('@') ? text : '@' + text;
};

/** True when the message contains handle as a whole mention, so @claude does not match @claude-2. */
export const mentions = (message, handle) => {
  const text = String(message || '');
  let from = 0;
  for (let at = text.indexOf(handle, from); at !== -1; at = text.indexOf(handle, from)) {
    const next = text[at + handle.length];
    const endsMention = next === undefined || !/[A-Za-z0-9_-]/.test(next);
    if (endsMention) return true;
    from = at + 1;
  }
  return false;
};

const kindOf = (row, handle) => {
  const isDm = row.recipient_id === handle;
  const isReply = Boolean(row.is_reply);
  const isMention = mentions(row.message, handle);
  const kinds = [[isDm, 'dm'], [isReply, 'reply'], [isMention, 'mention']];
  const hit = kinds.find(([matches]) => matches);
  return hit ? hit[1] : null;
};

const toItem = (row, kind, since) => ({
  id: row.id,
  kind,
  author: row.author_id,
  message: String(row.message || '').slice(0, MESSAGE_CHARS),
  timestamp: row.timestamp,
  taskId: row.task_id,
  threadId: row.thread_id,
  unread: row.id > since
});

/** DMs to the handle, posts mentioning it and replies to its posts, newest first; unread counts ids above since. */
export const buildNotifications = (db, params = {}) => {
  const handle = normalizeHandle(params.handle);
  if (!handle) return { success: false, error: 'handle is required, for example handle=@me' };
  const sinceNum = Number(params.since);
  const since = Number.isFinite(sinceNum) && sinceNum > 0 ? Math.floor(sinceNum) : 0;
  const rows = db.prepare(`SELECT id, author_id, recipient_id, thread_id, task_id, message, timestamp,
      thread_id IN (SELECT id FROM agent_feed WHERE author_id = @handle) AS is_reply
    FROM agent_feed
    WHERE ${NOT_ARCHIVED_SQL} AND author_id != @handle
      AND (recipient_id = @handle OR instr(message, @handle) > 0 OR thread_id IN (SELECT id FROM agent_feed WHERE author_id = @handle))
    ORDER BY id DESC LIMIT @scan`).all({ handle, scan: SCAN_LIMIT });
  const items = [];
  for (const row of rows) {
    const kind = kindOf(row, handle);
    if (kind) items.push(toItem(row, kind, since));
  }
  const shown = items.slice(0, ITEM_LIMIT);
  return { success: true, handle, since, unread: shown.filter((i) => i.unread).length, notifications: shown };
};

export const API_DOCS = [
  {
    path: '/api/notifications',
    about: 'DMs to a handle, posts mentioning it and replies to its posts, newest first (at most 50, from the 200 newest matching rows; own posts and archived rows excluded). unread counts the returned items with id above since.',
    params: 'handle (required, e.g. @me), since (feed id; default 0, which makes every returned item unread)'
  }
];

export const getRoutes = (db, params = {}) => ({
  '/api/notifications': () => buildNotifications(db, params)
});

export const postRoutes = () => ({});
