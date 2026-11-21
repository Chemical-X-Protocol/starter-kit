/**
 * Today digest: /api/digest/today, what the swarm did since local midnight (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 */
import { NOT_ARCHIVED_SQL } from './team/team-db-feed.js';

const TOP_AGENTS = 5;
const OPEN_BLOCKER_LIMIT = 10;
// Lock and guard churn is most of the feed; it is not "activity" for the digest.
const NOISE_EVENTS = ['lock_acquired', 'lock_released', 'lock_expired', 'lock_granted', 'lock_queued', 'lock_transferred', 'guard-bypass', 'guard-crash', 'heartbeat', 'test-queue'];

export const localMidnight = (now = Date.now()) => new Date(now).setHours(0, 0, 0, 0);

/** since is epoch milliseconds; anything that is not a positive number falls back to local midnight. */
export const resolveSince = (raw, now = Date.now()) => {
  const ms = Number(raw);
  const isUsable = raw !== undefined && raw !== '' && Number.isFinite(ms) && ms > 0;
  return isUsable ? Math.floor(ms) : localMidnight(now);
};

const countEvent = (db, since, type) => db
  .prepare(`SELECT COUNT(*) AS c FROM agent_feed WHERE ${NOT_ARCHIVED_SQL} AND timestamp >= ? AND event_type = ?`)
  .get(since, type)?.c || 0;

const topAgents = (db, since) => {
  const marks = NOISE_EVENTS.map(() => '?').join(',');
  return db
    .prepare(`SELECT author_id AS handle, COUNT(*) AS posts FROM agent_feed
      WHERE ${NOT_ARCHIVED_SQL} AND timestamp >= ? AND event_type NOT IN (${marks}) AND author_id != ''
      GROUP BY author_id ORDER BY posts DESC, author_id ASC LIMIT ?`)
    .all(since, ...NOISE_EVENTS, TOP_AGENTS)
    .map((r) => ({ handle: r.handle, posts: r.posts }));
};

const openBlockers = (db) => {
  const total = db.prepare("SELECT COUNT(*) AS c FROM agent_tasks WHERE status = 'blocked'").get()?.c || 0;
  const tasks = db
    .prepare("SELECT id, title FROM agent_tasks WHERE status = 'blocked' ORDER BY updated_at DESC LIMIT ?")
    .all(OPEN_BLOCKER_LIMIT);
  return { total, tasks };
};

export const buildDigest = (db, params = {}, now = Date.now()) => {
  const since = resolveSince(params.since, now);
  const counts = {
    commits: countEvent(db, since, 'commit'),
    tasksCompleted: countEvent(db, since, 'task_complete'),
    tasksCreated: countEvent(db, since, 'task_created'),
    handoffs: countEvent(db, since, 'task_handoff'),
    decisions: countEvent(db, since, 'decision')
  };
  const agents = topAgents(db, since);
  const blockers = openBlockers(db);
  const hasActivity = Object.values(counts).some((n) => n > 0) || agents.length > 0;
  return { success: true, since, until: now, ...counts, agents, openBlockers: blockers.total, blockers: blockers.tasks, hasActivity };
};

export const API_DOCS = [
  {
    path: '/api/digest/today',
    about: 'Counts from the team db since a start time: commits, tasks completed, tasks created, handoffs, decisions, the top 5 agents by non-lock posts, and tasks currently blocked (a count now, not since).',
    params: 'since (epoch milliseconds; default local midnight of the server)'
  }
];

export const getRoutes = (db, params = {}) => ({
  '/api/digest/today': () => buildDigest(db, params)
});

export const postRoutes = () => ({});
