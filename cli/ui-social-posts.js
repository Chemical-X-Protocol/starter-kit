/**
 * Permalinks: GET /api/posts/<id>, one feed post with its task and thread context (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 *   getPatterns(db, params, ctx) returns [[regex, (match) => result]] for id paths; this module uses it for /api/posts/<id>.
 */
export const API_DOCS = [
  {
    path: '/api/posts/:id',
    about: 'One feed post as {post, before, replies}: before is up to 5 earlier posts (oldest first) sharing the post task_id or thread, replies are posts whose thread_id is this id (oldest first). {success:false, error} when the id is missing; the HTTP status is not guaranteed to be 404.'
  }
];

export const BEFORE_LIMIT = 5;

/** The post, its earlier context and its replies; {success:false} when no such post or no feed table. */
export const readPostContext = (db, id) => {
  try {
    const post = db.prepare('SELECT * FROM agent_feed WHERE id = ?').get(id);
    if (!post) return { success: false, error: `No post with id ${id}.` };
    const earlier = db
      .prepare(
        `SELECT * FROM agent_feed WHERE id < ? AND (
           (? IS NOT NULL AND task_id = ?) OR (? IS NOT NULL AND thread_id = ?) OR (? IS NOT NULL AND id = ?)
         ) ORDER BY id DESC LIMIT ?`
      )
      .all(id, post.task_id, post.task_id, post.thread_id, post.thread_id, post.thread_id, post.thread_id, BEFORE_LIMIT);
    const replies = db.prepare('SELECT * FROM agent_feed WHERE thread_id = ? ORDER BY id ASC').all(id);
    return { success: true, post, before: earlier.reverse(), replies };
  } catch (err) {
    return { success: false, error: `Could not read post ${id}: ${err.message}` };
  }
};

export const getRoutes = () => ({});

export const postRoutes = () => ({});

/** With no db handle the pattern answers null, which the router treats as no match. */
export const getPatterns = (db) => [[/^\/api\/posts\/(\d+)$/, (match) => (db ? readPostContext(db, Number(match[1])) : null)]];
