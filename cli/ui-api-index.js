/**
 * GET /api/: a self-describing index of the UI's read endpoints, so an agent can page through
 * the swarm without reading the client source (#7604). Keep in step with ui-server-routes.js and docs/ui.md.
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, BOARD_COLUMNS } from './ui-paging.js';
import { listTasksPage, listTaskBoard } from './ui-paging-tasks.js';
import { listAgentsPage } from './ui-paging-agents.js';
import { readFeedPage, readLeases } from './ui-paging-feed.js';
import { SOCIAL_API_DOCS, socialGetRoutes } from './ui-social-routes.js';

const PAGING = `limit (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}), offset or page`;
const ENVELOPE = ['total', 'limit', 'offset', 'page', 'totalPages', 'hasMore', 'nextOffset'];

export const API_INDEX = {
  success: true,
  auth: 'Send the launch token as the x-chemx-token header, ?token=, or the cookie the token URL sets.',
  pagination: { params: PAGING, envelope: ENVELOPE, next: 'Repeat the call with offset=nextOffset until hasMore is false.' },
  endpoints: [
    { path: '/api/status', about: 'Live view: counts, the 50 most recently touched tasks and seen agents, the last 50 feed posts, leases.' },
    { path: '/api/tasks', about: 'Task cards, paged.', params: `${PAGING}; status (comma list; done includes completed, blocked includes failed), q (title, path, assignee or #id), tier, hideTests=1, sort=priority|recent|newest, full=1 for whole rows, plus the CLI filters: assigned_agent_id, repo, needs, search, parent_id, moscow, priority, sprint_tag` },
    { path: '/api/tasks/board', about: `First page of each board column (${BOARD_COLUMNS.join(', ')}) in one call.`, params: 'the /api/tasks filters, limit, columns (comma list)' },
    { path: '/api/tasks/:id', about: 'One whole task row, with description, brief and receipts.' },
    { path: '/api/agents', about: 'Agents, newest heartbeat first, paged, with counts per status.', params: `${PAGING}; status=all|active|idle|offline` },
    { path: '/api/feed', about: 'Feed posts oldest-first; hasMore and oldestId page backwards.', params: 'limit (default 50, max 200), before_id (older page), since_id (newer), task_id, thread_id, author_id, event_type' },
    { path: '/api/codebase', about: 'Indexed files with tier, lines and line budget.' },
    { path: '/api/db/browse', about: 'Rows of one code-index table, paged.', params: 'table, page, pageSize (max 100)' },
    ...SOCIAL_API_DOCS
  ]
};

/** The paged read routes, kept beside their description above; routeGet spreads them into its table. */
export const pagedRoutes = (db, params, ctx = {}) => ({
  ...socialGetRoutes(db, params, ctx),
  '/api/': () => API_INDEX,
  '/api/feed': () => readFeedPage(db, params),
  '/api/tasks': () => listTasksPage(db, params),
  '/api/tasks/board': () => listTaskBoard(db, params),
  '/api/agents': () => listAgentsPage(db, params, { leases: readLeases(db) })
});
