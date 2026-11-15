/**
 * Story feed: /api/feed/story, meaningful events with lock churn rolled up (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 *   Optional getPatterns(db, params, ctx) / postPatterns(db, body, ctx) return [[regex, (match) => result]]
 *   for id paths such as /api/posts/<id>; exact routes and the built-in routes are tried first.
 * Stub until its sprint task fills it in.
 */
export const API_DOCS = [];

export const getRoutes = () => ({});

export const postRoutes = () => ({});
