/**
 * DMs in chemx ui (#7651, folds in #7638): anyone can message any agent and read any agent's DMs.
 *   GET  /api/dms?handle=@x            conversations of @x, newest first: { with, count, unread, last }
 *   GET  /api/dms?handle=@x&with=@y    the thread between them, oldest first (newest 200)
 *   POST /api/dms { from, to, message } writes through sendDirectMessage, the path `chemx team dm` uses,
 *        so the message lands in the recipient's `chemx team inbox`.
 */
import { sendDirectMessage, normalizeHandle } from './team/team-db-mailbox.js';

const DM = "event_type = 'dm' AND recipient_id IS NOT NULL";
const toMessage = (r) => ({ id: r.id, from: r.author_id, to: r.recipient_id, message: r.message, timestamp: Number(r.timestamp), readAt: r.read_at ? Number(r.read_at) : null });

export const readConversations = (db, handle) => {
  const rows = db.prepare(`SELECT id, author_id, recipient_id, message, timestamp, read_at FROM agent_feed
    WHERE ${DM} AND (author_id = ? OR recipient_id = ?) ORDER BY id DESC LIMIT 2000`).all(handle, handle);
  const byPeer = new Map();
  for (const row of rows) {
    const peer = row.author_id === handle ? row.recipient_id : row.author_id;
    const entry = byPeer.get(peer) || { with: peer, count: 0, unread: 0, last: toMessage(row) };
    entry.count += 1;
    const isUnread = row.recipient_id === handle && !row.read_at;
    if (isUnread) entry.unread += 1;
    byPeer.set(peer, entry);
  }
  return [...byPeer.values()];
};

export const readThread = (db, handle, peer) => db.prepare(`SELECT id, author_id, recipient_id, message, timestamp, read_at FROM agent_feed
  WHERE ${DM} AND ((author_id = ? AND recipient_id = ?) OR (author_id = ? AND recipient_id = ?)) ORDER BY id DESC LIMIT 200`)
  .all(handle, peer, peer, handle).reverse().map(toMessage);

export const readDms = (db, params = {}) => {
  const handle = normalizeHandle(String(params.handle || '').trim());
  const canRead = Boolean(db) && Boolean(handle);
  if (!canRead) return { success: false, error: 'handle is required' };
  const peer = normalizeHandle(String(params.with || '').trim());
  if (peer) return { success: true, handle, with: peer, messages: readThread(db, handle, peer) };
  return { success: true, handle, conversations: readConversations(db, handle) };
};

export const postDm = (db, body = {}) => {
  const from = normalizeHandle(String(body.from || '').trim());
  const to = normalizeHandle(String(body.to || '').trim());
  const message = String(body.message || '').trim();
  const problem = [[!db, 'Database unavailable'], [!from, 'from is required'], [!to, 'to is required'], [!message, 'message is empty'], [from === to, 'cannot message yourself']]
    .find(([isBad]) => isBad);
  if (problem) return { success: false, error: problem[1] };
  return { success: true, message: toMessage(sendDirectMessage(db, { author_id: from, recipient_id: to, message })) };
};

export const API_DOCS = [{ path: '/api/dms', about: 'DM conversations of a handle, or the thread with one peer; POST { from, to, message } sends one.', params: 'handle (required), with' }];
export const getRoutes = (db, params) => ({ '/api/dms': () => readDms(db, params) });
export const postRoutes = (db, body) => ({ '/api/dms': () => postDm(db, body) });
