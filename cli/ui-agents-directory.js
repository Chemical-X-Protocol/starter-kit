/**
 * GET /api/agents/directory (#7645): the Agents page. One page of agents with what each is doing and has done.
 * params: kind=crew|sessions|all, status=all|active|idle|offline, q (handle, name or role), sort=recent|name|done,
 * limit (default 48, max 200), offset. Rows carry tasks done and in progress, the current task, post count and
 * last post time; tab counts cover the whole board. Crew = rows `chemx team crew import` tagged "crew".
 */
const CREW = `capabilities LIKE '%"crew"%'`;
const ORDER = { recent: 'a.heartbeat DESC, a.id', name: 'a.id COLLATE NOCASE', done: 'done DESC, a.heartbeat DESC' };

const whereFor = ({ kind = 'all', status = 'all', q = '' }) => {
  const conds = [];
  const values = [];
  const kindCond = { crew: CREW, sessions: `NOT ${CREW}` }[kind];
  if (kindCond) conds.push(kindCond);
  const hasStatus = Boolean(status) && status !== 'all';
  if (hasStatus) { conds.push('a.status = ?'); values.push(status); }
  const needle = String(q || '').trim();
  if (needle) { conds.push('(a.id LIKE ? OR a.name LIKE ? OR a.role LIKE ?)'); values.push(...Array(3).fill(`%${needle}%`)); }
  return { sql: conds.length ? ` WHERE ${conds.join(' AND ')}` : '', values };
};

const readMeta = (raw) => {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } // chemx-allow: a malformed metadata cell reads as none
};

const postStats = (db, ids) => {
  const hasIds = ids.length > 0;
  if (!hasIds) return new Map();
  const rows = db.prepare(`SELECT author_id AS id, COUNT(*) AS posts, MAX(timestamp) AS lastPostAt FROM agent_feed
    WHERE author_id IN (${ids.map(() => '?').join(',')}) GROUP BY author_id`).all(...ids);
  return new Map(rows.map((r) => [r.id, r]));
};

const tabCounts = (db) => {
  const row = db.prepare(`SELECT COUNT(*) AS all_, SUM(CASE WHEN ${CREW} THEN 1 ELSE 0 END) AS crew,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) AS idle,
    SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline FROM agents`).get() || {};
  return { all: row.all_ || 0, crew: row.crew || 0, sessions: (row.all_ || 0) - (row.crew || 0), active: row.active || 0, idle: row.idle || 0, offline: row.offline || 0 };
};

export const readDirectory = (db, params = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const limit = Math.min(Math.max(Number(params.limit) || 48, 1), 200);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const { sql, values } = whereFor(params);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM agents a${sql}`).get(...values)?.c || 0;
  const rows = db.prepare(`SELECT a.id, a.name, a.role, a.status, a.heartbeat, a.capabilities, a.metadata,
      (SELECT COUNT(*) FROM agent_tasks t WHERE t.assigned_agent_id = a.id AND t.status = 'done') AS done,
      (SELECT COUNT(*) FROM agent_tasks t WHERE t.assigned_agent_id = a.id AND t.status = 'in_progress') AS active,
      (SELECT t.id || char(31) || t.title FROM agent_tasks t WHERE t.assigned_agent_id = a.id AND t.status = 'in_progress' ORDER BY t.updated_at DESC LIMIT 1) AS current
    FROM agents a${sql} ORDER BY ${ORDER[params.sort] || ORDER.recent} LIMIT ? OFFSET ?`).all(...values, limit, offset);
  const stats = postStats(db, rows.map((r) => r.id));
  const agents = rows.map((r) => {
    const meta = readMeta(r.metadata);
    const [taskId, taskTitle] = r.current ? r.current.split('\u001f') : [];
    return {
      id: r.id, name: r.name || r.id, role: r.role || '', status: r.status || 'offline', heartbeat: Number(r.heartbeat) || null,
      isCrew: String(r.capabilities || '').includes('"crew"'), model: meta.model || '', source: meta.source || '',
      tier: (String(r.capabilities || '').match(/"tier:(light|standard|deep)"/) || [])[1] || '',
      done: r.done, inProgress: r.active, currentTask: taskId ? { id: Number(taskId), title: taskTitle } : null,
      posts: stats.get(r.id)?.posts || 0, lastPostAt: stats.get(r.id)?.lastPostAt || null
    };
  });
  return { success: true, agents, total, limit, offset, hasMore: offset + agents.length < total, counts: tabCounts(db) };
};

export const API_DOCS = [{ path: '/api/agents/directory', about: 'Agents with tasks done, in progress, current task, posts and last post; crew or sessions.', params: 'kind=crew|sessions|all, status, q, sort=recent|name|done, limit (max 200), offset' }];
export const getRoutes = (db, params) => ({ '/api/agents/directory': () => readDirectory(db, params) });
export const postRoutes = () => ({});
