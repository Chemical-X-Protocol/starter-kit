/**
 * Chemical X Protocol: Unified Swarm Database Layer
 * Aggregates agent registry, task DAG, activity feed, and lock manager
 */

export {
  getAgent,
  registerAgent,
  updateAgentHeartbeat,
  listAgents
} from './team-db-agents.js';

export {
  getTask,
  createTask,
  claimTask,
  updateTaskStatus,
  listTasks,
  areTaskDependenciesMet
} from './team-db-tasks.js';

export {
  postFeedEvent,
  queryFeed
} from './team-db-feed.js';

export {
  requestFileLock,
  releaseFileLock,
  getFileLockStatus,
  cleanExpiredLeases,
  promoteNextWaiter
} from './team-db-locks.js';

import { cleanExpiredLeases } from './team-db-locks.js';
import { queryFeed } from './team-db-feed.js';

export const getSwarmStatus = (db) => {
  if (!db) return null;
  cleanExpiredLeases(db);

  const agents = db.prepare('SELECT status, COUNT(*) as count FROM agents GROUP BY status').all();
  const agentSummary = { total: 0, idle: 0, busy: 0, offline: 0 };
  for (const a of agents) {
    agentSummary[a.status] = a.count;
    agentSummary.total += a.count;
  }

  const tasks = db.prepare('SELECT status, COUNT(*) as count FROM agent_tasks GROUP BY status').all();
  const taskSummary = { total: 0, queued: 0, in_progress: 0, review: 0, done: 0, blocked: 0, failed: 0 };
  for (const t of tasks) {
    taskSummary[t.status] = t.count;
    taskSummary.total += t.count;
  }

  const activeLocks = db.prepare('SELECT file_path, locked_by, expires_at FROM file_leases').all();
  const waitingLocks = db.prepare("SELECT COUNT(*) as count FROM file_lock_queue WHERE status = 'waiting'").get();

  const blockedTasks = db.prepare(`
    SELECT id, title, assigned_agent_id, blocked_reason, target_path
    FROM agent_tasks
    WHERE status = 'blocked'
    ORDER BY id ASC
  `).all();

  const tokenRow = db.prepare(`
    SELECT COALESCE(SUM(prompt_tokens), 0) as p, COALESCE(SUM(completion_tokens), 0) as c,
           COALESCE(SUM(cached_tokens), 0) as k, COALESCE(SUM(total_tokens), 0) as tot,
           COALESCE(SUM(cost_usd), 0.0) as cost FROM agent_tasks
  `).get() || { p: 0, c: 0, k: 0, tot: 0, cost: 0.0 };

  const tokens = {
    prompt: Number(tokenRow.p), completion: Number(tokenRow.c),
    cached: Number(tokenRow.k), total: Number(tokenRow.tot),
    cost_usd: Number(Number(tokenRow.cost).toFixed(6))
  };

  const recentFeed = queryFeed(db, { limit: 5 });

  return {
    agents: agentSummary,
    tasks: taskSummary,
    locks: {
      active: activeLocks.length,
      waiting: waitingLocks?.count || 0,
      leases: activeLocks
    },
    tokens,
    blockedTasks,
    recentFeed
  };
};

