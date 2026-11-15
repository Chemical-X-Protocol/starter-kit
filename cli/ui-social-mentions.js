/**
 * Mentions and handles: GET /api/mentions?handle=@x and GET /api/handles?q= (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 */
import { readPageParams, pageEnvelope } from './ui-paging.js';

export const API_DOCS = [
  {
    path: '/api/mentions',
    about: 'Feed posts whose message mentions a handle, newest first, paged. A mention is the handle at a word boundary, so @ab does not match @abc. Only the newest 2000 posts containing the text are scanned.',
    params: 'handle (required, with or without the leading @), limit (default 50, max 200), offset or page'
  },
  {
    path: '/api/handles',
    about: 'Handles for @ autocomplete: registered agents first, then other feed authors, at most limit rows. Not a list of who may be mentioned.',
    params: 'q (substring of the handle or agent name, case-insensitive, optional), limit (default 8, max 50)'
  }
];

export const MENTION_SCAN_CAP = 2000;
const HANDLE_LIMIT_MAX = 50;

const normalizeHandle = (raw) => {
  const bare = String(raw || '').trim().replace(/^@+/, '');
  return bare ? `@${bare}` : '';
};

const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Posts mentioning params.handle, newest first, with the paging envelope. */
export const listMentions = (db, params = {}) => {
  const handle = normalizeHandle(params.handle);
  const paging = readPageParams(params, 50);
  if (!db) return { success: false, error: 'Database unavailable' };
  if (!handle) return { success: false, error: 'handle is required, for example ?handle=@agent.' };
  try {
    const boundary = new RegExp(`${escapeRegex(handle)}(?![\\w-])`, 'i');
    const rows = db
      .prepare("SELECT * FROM agent_feed WHERE message LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?")
      .all(`%${escapeLike(handle)}%`, MENTION_SCAN_CAP);
    const matches = rows.filter((row) => boundary.test(row.message));
    const posts = matches.slice(paging.offset, paging.offset + paging.limit);
    return { success: true, handle, posts, ...pageEnvelope(matches.length, paging, posts.length) };
  } catch (err) {
    return { success: false, error: `Could not read mentions: ${err.message}` };
  }
};

/** Agent handles, then other feed authors, matching params.q. */
export const listHandles = (db, params = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const rawLimit = Number.parseInt(params.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(HANDLE_LIMIT_MAX, Math.max(1, rawLimit)) : 8;
  const like = `%${escapeLike(String(params.q || '').trim().replace(/^@+/, ''))}%`;
  try {
    const agents = db
      .prepare("SELECT id, name, role, status FROM agents WHERE (id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY heartbeat DESC LIMIT ?")
      .all(like, like, limit)
      .map((a) => ({ handle: normalizeHandle(a.id), name: a.name, role: a.role, status: a.status, isAgent: true }));
    const known = new Set(agents.map((a) => a.handle));
    const authors = db
      .prepare("SELECT author_id AS id, MAX(id) AS last FROM agent_feed WHERE author_id LIKE ? ESCAPE '\\' GROUP BY author_id ORDER BY last DESC LIMIT ?")
      .all(like, limit)
      .map((a) => ({ handle: normalizeHandle(a.id), name: '', role: '', status: '', isAgent: false }))
      .filter((a) => !known.has(a.handle));
    return { success: true, handles: [...agents, ...authors].slice(0, limit) };
  } catch (err) {
    return { success: false, error: `Could not read handles: ${err.message}` };
  }
};

export const getRoutes = (db, params = {}) => ({
  '/api/mentions': () => listMentions(db, params),
  '/api/handles': () => listHandles(db, params)
});

export const postRoutes = () => ({});
