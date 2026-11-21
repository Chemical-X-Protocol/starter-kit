/** Paged agent reads (#7604): the most recent heartbeat first, with counts for each filter chip. */
import { resolveAgentMeta } from './ui-forum-data.js';
import { readPageParams, pageEnvelope } from './ui-paging.js';

const ACTIVE_AGENT_STATUSES = ['busy', 'active', 'running'];

const buildAgentWhere = (params = {}) => {
  const status = String(params.status || '');
  const isAll = !status || status === 'all';
  if (isAll) return { where: '', values: [] };
  const statuses = status === 'active' ? ACTIVE_AGENT_STATUSES : [status];
  return { where: ` WHERE status IN (${statuses.map(() => '?').join(', ')})`, values: statuses };
};

export const countAgents = (db) => {
  const counts = { all: 0, active: 0, idle: 0, offline: 0 };
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM agents GROUP BY status').all()) {
    counts.all += row.c;
    const key = ACTIVE_AGENT_STATUSES.includes(row.status) ? 'active' : row.status;
    counts[key] = (counts[key] || 0) + row.c;
  }
  return counts;
};

export const listAgentsPage = (db, params = {}, { leases = [], posts = [] } = {}) => {
  const paging = readPageParams(params, 50);
  if (!db) return { success: true, agents: [], counts: {}, ...pageEnvelope(0, paging, 0) };
  const { where, values } = buildAgentWhere(params);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM agents${where}`).get(...values)?.c || 0;
  const rows = db.prepare(`SELECT id, name, role, status, current_task_id AS currentTaskId, heartbeat, metadata
    FROM agents${where} ORDER BY heartbeat DESC, id ASC LIMIT ? OFFSET ?`).all(...values, paging.limit, paging.offset);
  const agents = rows.map((a) => resolveAgentMeta(a, leases, posts));
  return { success: true, agents, counts: countAgents(db), ...pageEnvelope(total, paging, agents.length) };
};
