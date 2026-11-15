/**
 * Today digest: /api/digest, what the swarm did today (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 * Stub until its sprint task fills it in.
 */
export const API_DOCS = [];

export const getRoutes = () => ({});

export const postRoutes = () => ({});
