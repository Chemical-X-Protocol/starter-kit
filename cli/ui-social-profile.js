/**
 * Agent profiles: GET /api/agents/<handle>/profile (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 *   getPatterns(db, params, ctx) returns [[regex, (match) => result]] for id paths; this module uses one.
 * The handle may be written with or without the leading @ (@ may also arrive as %40).
 */
import { getAgent } from './team/team-db-agents.js';
import { queryFeed } from './team/team-db-feed.js';

export const PROFILE_POST_LIMIT = 20;
const DONE_STATUSES = ['done', 'completed'];

export const API_DOCS = [
  {
    path: '/api/agents/:handle/profile',
    about: 'One agent: its row (status, role, heartbeat), counts (posts, commits, tasksDone, tasksInProgress), current claims (in-progress tasks assigned to it), live leases (not yet expired) and its latest posts oldest-first with hasMore and oldestId paging backwards. An unknown handle returns {success:false}. Counts cover feed rows by this author and tasks assigned to it; archived feed rows are not counted.',
    params: 'before_id (older posts), limit (default 20, max 200)'
  }
];

const count = (db, sql, ...values) => db.prepare(sql).get(...values)?.c || 0;

const readCounts = (db, id) => {
  const notArchived = "COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.archived'), 0) != 1";
  const feedSql = (extra) => `SELECT COUNT(*) AS c FROM agent_feed WHERE author_id = ? AND ${notArchived}${extra}`;
  const inDone = DONE_STATUSES.map(() => '?').join(', ');
  return {
    posts: count(db, feedSql(''), id),
    commits: count(db, feedSql(" AND event_type = 'commit'"), id),
    tasksDone: count(db, `SELECT COUNT(*) AS c FROM agent_tasks WHERE assigned_agent_id = ? AND status IN (${inDone})`, id, ...DONE_STATUSES),
    tasksInProgress: count(db, "SELECT COUNT(*) AS c FROM agent_tasks WHERE assigned_agent_id = ? AND status = 'in_progress'", id)
  };
};

const readClaims = (db, id) => db.prepare(
  "SELECT id, title, status, priority, updated_at AS updatedAt FROM agent_tasks WHERE assigned_agent_id = ? AND status = 'in_progress' ORDER BY updated_at DESC"
).all(id);

const readLiveLeases = (db, id) => db.prepare(
  'SELECT file_path AS filePath, acquired_at AS acquiredAt, expires_at AS expiresAt, purpose FROM file_leases WHERE locked_by = ? AND expires_at > ? ORDER BY acquired_at DESC'
).all(id, Date.now());

const readPosts = (db, id, params) => {
  const requested = Number(params.limit);
  const hasLimit = Number.isFinite(requested) && requested >= 1;
  const limit = hasLimit ? Math.min(Math.floor(requested), 200) : PROFILE_POST_LIMIT;
  const feed = queryFeed(db, { author_id: id, limit, before_id: params.before_id });
  return { feed, hasMore: feed.length === limit, oldestId: feed.length > 0 ? feed[0].id : null };
};

const readRecentDone = (db, id) => db.prepare(
  "SELECT id, title, status, updated_at AS updatedAt FROM agent_tasks WHERE assigned_agent_id = ? AND status IN ('done', 'completed') ORDER BY updated_at DESC LIMIT 15"
).all(id);

// Crew rows carry model and source in metadata and "crew" / "tier:<x>" in capabilities (chemx team crew import).
const pickAgent = (a) => {
  const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const caps = Array.isArray(a.capabilities) ? a.capabilities : [];
  const tierCap = caps.find((c) => String(c).startsWith('tier:'));
  return {
    id: a.id, name: a.name, role: a.role, status: a.status, heartbeat: a.heartbeat,
    currentTaskId: a.current_task_id, capabilities: a.capabilities,
    isCrew: caps.includes('crew'), tier: tierCap ? String(tierCap).slice(5) : '', model: meta.model || '', source: meta.source || ''
  };
};

export const readProfile = (db, handle, params = {}) => {
  const agent = db ? getAgent(db, handle) : null;
  if (!agent) return { success: false, error: 'Unknown agent' };
  return {
    success: true,
    agent: pickAgent(agent),
    counts: readCounts(db, agent.id),
    claims: readClaims(db, agent.id),
    recentDone: readRecentDone(db, agent.id),
    leases: readLiveLeases(db, agent.id),
    ...readPosts(db, agent.id, params)
  };
};

const decodeHandle = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const getRoutes = () => ({});

export const getPatterns = (db, params) => [
  [/^\/api\/agents\/([^/]+)\/profile$/, (match) => readProfile(db, decodeHandle(match[1]), params)]
];

export const postRoutes = () => ({});
