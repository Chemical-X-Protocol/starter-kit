/**
 * Chemical X Protocol: Forum Categories and Postbit Data Engine
 */
const DEFAULT_MODEL = 'Gemini 3.8 Flash', DEFAULT_SIG = 'Chemical X Swarm Agent // Autonomous Molecular Worker';

const KNOWN_AGENTS = {
  '@orchestrator': { name: 'Swarm Orchestrator', role: 'orchestrator', model: 'Gemini 3.8 Flash', userTitle: 'Swarm Orchestrator' },
  '@teamwork-lead': { name: 'Teamwork Lead', role: 'coordinator', model: 'Gemini 3.8 Flash', userTitle: 'Swarm Coordinator' },
  '@victory-auditor': { name: 'Victory Auditor', role: 'auditor', model: 'Gemini 3.8 Flash', userTitle: 'Forensic Auditor' },
  '@frontend-engineer': { name: 'Frontend Specialist', role: 'specialist', model: 'Gemini 3.8 Flash', userTitle: 'UI Specialist' },
  '@database-specialist': { name: 'Database Specialist', role: 'specialist', model: 'Gemini 3.8 Flash', userTitle: 'DB Specialist' },
  '@sentinel': { name: 'System Sentinel', role: 'sentinel', model: 'Gemini 3.8 Flash', userTitle: 'System Sentinel' },
  '@system': { name: 'Chemical X Core', role: 'system', model: 'Gemini 3.8 Flash', userTitle: 'System Engine' },
  '@user': { name: 'Project Director', role: 'director', model: 'Human Operator', userTitle: 'Project Director' }
};

const ROLE_TITLES = { orchestrator: 'Swarm Orchestrator', coordinator: 'Swarm Coordinator', auditor: 'Forensic Auditor', director: 'Project Director', sentinel: 'System Sentinel', system: 'System Engine', specialist: 'Domain Specialist', worker: 'Core Implementer' };

const resolveUserTitle = (role, metaTitle) => {
  if (metaTitle) return metaTitle;
  const hasRole = Object.prototype.hasOwnProperty.call(ROLE_TITLES, role);
  if (hasRole) return ROLE_TITLES[role];
  return 'Swarm Contributor';
};

const resolveStatusBeacon = (status) => {
  if (status === 'busy') return 'busy';
  if (status === 'offline') return 'offline';
  return 'idle';
};

export const STANDARD_CATEGORIES = [
  { id: 'announcements', name: 'Announcements', desc: 'System-wide directives, milestone declarations, and broadcasts.' },
  { id: 'directives', name: 'Active Swarm Directives', desc: 'In-flight milestone tasks, priority queues, and task progress.' },
  { id: 'war-room', name: 'War Room', desc: 'Critical blockers, contention escalations, and audit reviews.' },
  { id: 'locks', name: 'Lock Registry', desc: 'Active file leases, lock queues, and resource synchronization.' },
  { id: 'general', name: 'General Chat', desc: 'Agent feed chatter, status broadcasts, and swarm banter.' }
];

export const getForumCategories = (db) => {
  if (!db) return STANDARD_CATEGORIES.map((c) => ({ ...c, threadsCount: 0, postsCount: 0, lastPostTimestamp: Date.now(), authorBadge: '@system' }));
  const now = Date.now();
  const feedCount = db.prepare('SELECT COUNT(*) as c FROM agent_feed').get()?.c || 0;
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM agent_tasks').get()?.c || 0;
  const activeTasks = db.prepare("SELECT COUNT(*) as c FROM agent_tasks WHERE status IN ('in_progress', 'queued')").get()?.c || 0;
  const blockedTasks = db.prepare("SELECT COUNT(*) as c FROM agent_tasks WHERE status = 'blocked' OR priority = 1").get()?.c || 0;
  const leaseCount = db.prepare('SELECT COUNT(*) as c FROM file_leases').get()?.c || 0;
  const queueCount = db.prepare('SELECT COUNT(*) as c FROM file_lock_queue').get()?.c || 0;
  const latestFeed = db.prepare('SELECT timestamp, author_id FROM agent_feed ORDER BY id DESC LIMIT 1').get();
  const latestBroadcast = db.prepare("SELECT timestamp, author_id FROM agent_feed WHERE event_type = 'broadcast' ORDER BY id DESC LIMIT 1").get();
  const latestTask = db.prepare('SELECT updated_at, assigned_agent_id FROM agent_tasks ORDER BY updated_at DESC LIMIT 1').get();
  const latestLease = db.prepare('SELECT acquired_at, locked_by FROM file_leases ORDER BY acquired_at DESC LIMIT 1').get();

  return [
    { id: 'announcements', name: 'Announcements', desc: STANDARD_CATEGORIES[0].desc, threadsCount: 1, postsCount: Math.max(1, db.prepare("SELECT COUNT(*) as c FROM agent_feed WHERE event_type = 'broadcast'").get()?.c || 0), lastPostTimestamp: latestBroadcast?.timestamp || now, authorBadge: latestBroadcast?.author_id || '@orchestrator' },
    { id: 'directives', name: 'Active Swarm Directives', desc: STANDARD_CATEGORIES[1].desc, threadsCount: activeTasks, postsCount: taskCount, lastPostTimestamp: latestTask?.updated_at || now, authorBadge: latestTask?.assigned_agent_id || '@coordinator' },
    { id: 'war-room', name: 'War Room', desc: STANDARD_CATEGORIES[2].desc, threadsCount: blockedTasks, postsCount: blockedTasks, lastPostTimestamp: now, authorBadge: '@sentinel' },
    { id: 'locks', name: 'Lock Registry', desc: STANDARD_CATEGORIES[3].desc, threadsCount: leaseCount, postsCount: leaseCount + queueCount, lastPostTimestamp: latestLease?.acquired_at || now, authorBadge: latestLease?.locked_by || '@coordinator' },
    { id: 'general', name: 'General Chat', desc: STANDARD_CATEGORIES[4].desc, threadsCount: Math.max(1, Math.ceil(feedCount / 5)), postsCount: feedCount, lastPostTimestamp: latestFeed?.timestamp || now, authorBadge: latestFeed?.author_id || '@frontend-engineer' }
  ];
};

export const resolveAgentMeta = (agent, leases = [], feedPosts = []) => {
  const meta = typeof agent.metadata === 'string' ? JSON.parse(agent.metadata || '{}') : (agent.metadata || {});
  const known = KNOWN_AGENTS[agent.id] || {};
  const model = meta.model || known.model || DEFAULT_MODEL;
  const signature = meta.signature || known.signature || (agent.role === 'coordinator' ? 'Swarm DAG Coordinator // File Lease Registry' : DEFAULT_SIG);
  const userTitle = resolveUserTitle(agent.role || known.role, meta.userTitle || known.userTitle);
  const rankStars = (agent.role === 'coordinator' || agent.role === 'orchestrator' || known.role === 'orchestrator' || known.role === 'director') ? '★★★★★' : '★★★★☆';
  const held = leases.filter((l) => l.lockedBy === agent.id).map((l) => l.filePath);
  const postsCount = feedPosts.filter((p) => (p.author || p.author_id) === agent.id).length;
  const statusBeacon = resolveStatusBeacon(agent.status);

  return {
    id: agent.id, name: agent.name || known.name || agent.id, role: agent.role || known.role || 'worker', status: agent.status || 'idle',
    statusBeacon, model, userTitle, rankStars, joinDate: 'Sep 2026', postsCount, heldLeases: held,
    currentTaskId: agent.currentTaskId || agent.current_task_id || null, signature
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
