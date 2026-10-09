// Chemical X Protocol: Forum Categories and Postbit Data Engine.
import { NOT_ARCHIVED_SQL } from './team/team-db-feed.js';

export const UNKNOWN_LABEL = 'Unknown';

const ROLE_TITLES = { orchestrator: 'Swarm Orchestrator', coordinator: 'Swarm Coordinator', auditor: 'Forensic Auditor', director: 'Project Director', sentinel: 'System Sentinel', system: 'System Engine', specialist: 'Domain Specialist', worker: 'Core Implementer' };
const LEAD_ROLES = new Set(['coordinator', 'orchestrator', 'director']);
const STATUS_BEACONS = new Set(['busy', 'offline']);

const resolveUserTitle = (role, metaTitle) => {
  if (metaTitle) return metaTitle;
  const hasRole = Object.prototype.hasOwnProperty.call(ROLE_TITLES, role);
  if (hasRole) return ROLE_TITLES[role];
  return 'Swarm Contributor';
};

const resolveStatusBeacon = (status) => {
  const isKnownBeacon = STATUS_BEACONS.has(status);
  return isKnownBeacon ? status : 'idle';
};

const parseMeta = (metadata) => {
  const isText = typeof metadata === 'string';
  return isText ? JSON.parse(metadata || '{}') : (metadata || {});
};

export const STANDARD_CATEGORIES = [
  { id: 'announcements', name: 'Announcements', desc: 'System-wide directives, milestone declarations, and broadcasts.' },
  { id: 'directives', name: 'Active Swarm Directives', desc: 'In-flight milestone tasks, priority queues, and task progress.' },
  { id: 'war-room', name: 'War Room', desc: 'Critical blockers, contention escalations, and audit reviews.' },
  { id: 'locks', name: 'Lock Registry', desc: 'Active file leases, lock queues, and resource synchronization.' },
  { id: 'general', name: 'General Chat', desc: 'Agent feed chatter, status broadcasts, and swarm banter.' }
];

const emptyCategory = (category) => ({ ...category, threadsCount: 0, postsCount: 0, lastPostTimestamp: 0, authorBadge: UNKNOWN_LABEL });
const countOf = (db, sql) => db.prepare(sql).get()?.c || 0;
const latestOf = (row, atKey, byKey) => ({ at: Number(row?.[atKey] || 0), by: row?.[byKey] || UNKNOWN_LABEL });

export const getForumCategories = (db) => {
  if (!db) return STANDARD_CATEGORIES.map(emptyCategory);
  const liveFeed = `FROM agent_feed WHERE ${NOT_ARCHIVED_SQL}`;
  const blockedWhere = "WHERE status = 'blocked' OR priority = 1";
  const feedCount = countOf(db, `SELECT COUNT(*) as c ${liveFeed}`);
  const broadcastCount = countOf(db, `SELECT COUNT(*) as c ${liveFeed} AND event_type = 'broadcast'`);
  const taskCount = countOf(db, 'SELECT COUNT(*) as c FROM agent_tasks');
  const activeTasks = countOf(db, "SELECT COUNT(*) as c FROM agent_tasks WHERE status IN ('in_progress', 'queued')");
  const blockedTasks = countOf(db, `SELECT COUNT(*) as c FROM agent_tasks ${blockedWhere}`);
  const leaseCount = countOf(db, 'SELECT COUNT(*) as c FROM file_leases');
  const queueCount = countOf(db, 'SELECT COUNT(*) as c FROM file_lock_queue');
  const feed = latestOf(db.prepare(`SELECT timestamp, author_id ${liveFeed} ORDER BY id DESC LIMIT 1`).get(), 'timestamp', 'author_id');
  const broadcast = latestOf(db.prepare(`SELECT timestamp, author_id ${liveFeed} AND event_type = 'broadcast' ORDER BY id DESC LIMIT 1`).get(), 'timestamp', 'author_id');
  const task = latestOf(db.prepare('SELECT updated_at, assigned_agent_id FROM agent_tasks ORDER BY updated_at DESC LIMIT 1').get(), 'updated_at', 'assigned_agent_id');
  const blocker = latestOf(db.prepare(`SELECT updated_at, assigned_agent_id FROM agent_tasks ${blockedWhere} ORDER BY updated_at DESC LIMIT 1`).get(), 'updated_at', 'assigned_agent_id');
  const lease = latestOf(db.prepare('SELECT acquired_at, locked_by FROM file_leases ORDER BY acquired_at DESC LIMIT 1').get(), 'acquired_at', 'locked_by');
  const [announcements, directives, warRoom, locks, general] = STANDARD_CATEGORIES;
  return [
    { ...announcements, threadsCount: Math.min(1, broadcastCount), postsCount: broadcastCount, lastPostTimestamp: broadcast.at, authorBadge: broadcast.by },
    { ...directives, threadsCount: activeTasks, postsCount: taskCount, lastPostTimestamp: task.at, authorBadge: task.by },
    { ...warRoom, threadsCount: blockedTasks, postsCount: blockedTasks, lastPostTimestamp: blocker.at, authorBadge: blocker.by },
    { ...locks, threadsCount: leaseCount, postsCount: leaseCount + queueCount, lastPostTimestamp: lease.at, authorBadge: lease.by },
    { ...general, threadsCount: Math.ceil(feedCount / 5), postsCount: feedCount, lastPostTimestamp: feed.at, authorBadge: feed.by }
  ];
};

export const resolveAgentMeta = (agent, leases = [], feedPosts = []) => {
  const meta = parseMeta(agent.metadata);
  const role = agent.role || '';
  const isLead = LEAD_ROLES.has(role);
  const held = leases.filter((l) => l.lockedBy === agent.id).map((l) => l.filePath);
  const postsCount = feedPosts.filter((p) => (p.author || p.author_id) === agent.id).length;
  return {
    id: agent.id, name: agent.name || agent.id, role: role || UNKNOWN_LABEL, status: agent.status || 'idle',
    statusBeacon: resolveStatusBeacon(agent.status), model: meta.model || UNKNOWN_LABEL,
    userTitle: resolveUserTitle(role, meta.userTitle), rankStars: isLead ? '★★★★★' : '★★★★☆',
    joinDate: meta.joinDate || '', lastSeen: Number(agent.heartbeat || 0), postsCount, heldLeases: held,
    currentTaskId: agent.currentTaskId || agent.current_task_id || null, signature: meta.signature || ''
  };
};

export const formatTokenStamp = (msgLength = 50, p = 350) => {
  const c = Math.max(20, Math.ceil(msgLength / 4));
  const cost = (p * 0.000003) + (c * 0.000015);
  return `[P: ${p} | C: ${c} | Cost: $${cost.toFixed(4)}]`;
};

export const updateAgentSignatureInDb = (db, agentId, signature) => {
  const isValid = Boolean(db && agentId);
  if (!isValid) return false;
  const cleanId = agentId.startsWith('@') ? agentId : `@${agentId}`;
  const row = db.prepare('SELECT metadata FROM agents WHERE id = ?').get(cleanId);
  if (!row) return false;
  const meta = JSON.parse(row.metadata || '{}');
  meta.signature = signature;
  db.prepare('UPDATE agents SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), cleanId);
  return true;
};
