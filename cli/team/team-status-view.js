/**
 * Chemical X Protocol: the swarm status in the sizes callers ask for (K4, #6749).
 * One JSON shape for `team status --json` and the chemx_team_status MCP tool, the blocked-task list only
 * when asked for, and a view scoped to one handle. Guaranteed: scoping reads open tasks assigned to the
 * handle, leases it holds and events it authored, nothing of anyone else's. Not guaranteed: the board
 * totals (agents, tasks, token counts) stay board-wide in a scoped view.
 */

import { toColumnar } from '../columnar.js';
import { queryFeed } from './team-db-feed.js';

const SCOPED_FEED_LIMIT = 4;
const OPEN_TASK_STATUSES = "'queued', 'in_progress', 'review', 'blocked'";

/** The status with only `agentId`'s open tasks, live leases and own events in it (plus `mine` for the card). */
export const scopeStatusToAgent = (db, status, agentId) => {
  const tasks = db.prepare(`SELECT id, title, status, blocked_reason FROM agent_tasks WHERE assigned_agent_id = ? AND status IN (${OPEN_TASK_STATUSES}) ORDER BY id ASC`).all(agentId);
  const leases = status.locks.leases.filter((lease) => lease.locked_by === agentId);
  return {
    ...status,
    locks: { ...status.locks, leases },
    recentFeed: queryFeed(db, { author_id: agentId, limit: SCOPED_FEED_LIMIT }),
    mine: { agentId, tasks, leases }
  };
};

/** @param {{blockers?: boolean}} options blockers: also list the blocked tasks (the count is always there) */
export const buildStatusView = (status, { blockers = false } = {}) => {
  const view = {
    agents: status.agents,
    tasks: status.tasks,
    locks: {
      active: status.locks.active,
      waiting: status.locks.waiting,
      leases: toColumnar(status.locks.leases, ['file_path', 'locked_by', 'expires_at'])
    },
    tokens: status.tokens,
    recentFeed: toColumnar(status.recentFeed, ['id', 'timestamp', 'author_id', 'event_type', 'message'])
  };
  if (blockers) view.blockedTasks = toColumnar(status.blockedTasks, ['id', 'title', 'assigned_agent_id', 'blocked_reason']);
  const isScoped = Boolean(status.mine);
  if (isScoped) {
    view.mine = {
      agentId: status.mine.agentId,
      tasks: toColumnar(status.mine.tasks, ['id', 'title', 'status', 'blocked_reason']),
      leases: toColumnar(status.mine.leases, ['file_path', 'expires_at'])
    };
  }
  return view;
};
