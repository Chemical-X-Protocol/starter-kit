import {
  getSwarmStatus,
  postFeedEvent,
  listTasks,
  getFileLockStatus
} from './team/team-db.js';
import { calculateSavings } from './ui-actions-helpers.js';

export const getAggregatedTelemetry = (db) => {
  if (!db) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 };
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(prompt_tokens), 0) as promptTokens,
        COALESCE(SUM(completion_tokens), 0) as completionTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(cost_usd), 0) as totalCost
      FROM agent_tasks
    `).get();
    if (row) return row;
  } catch {}
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 };
};

export const handleSwarmStatus = (db) => {
  if (!db) return { error: 'Database unavailable' };
  const rawStatus = getSwarmStatus(db) || {};
  const rawFeed = db.prepare('SELECT * FROM agent_feed ORDER BY id DESC LIMIT 50').all() || [];
  const rawTasks = listTasks(db) || [];
  const rawLocks = getFileLockStatus(db) || [];
  const telemetry = getAggregatedTelemetry(db);

  const agents = db.prepare('SELECT id, name, role, status, current_task_id as currentTaskId, heartbeat FROM agents').all().map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    currentTaskId: a.currentTaskId,
    heartbeat: Number(a.heartbeat)
  }));

  const posts = rawFeed.map((f) => ({
    id: f.id,
    author: f.author_id,
    eventType: f.event_type,
    message: f.message,
    timestamp: Number(f.timestamp),
    channel: f.channel
  }));

  const leases = rawLocks.map((l) => ({
    filePath: l.file_path,
    lockedBy: l.locked_by,
    acquiredAt: Number(l.acquired_at),
    expiresAt: Number(l.expires_at),
    purpose: l.purpose,
    waitingCount: l.waiting_count || 0
  }));

  const tasks = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignedAgentId: t.assigned_agent_id
  }));

  const waitingLocks = db.prepare("SELECT COUNT(*) as count FROM file_lock_queue WHERE status = 'waiting'").get();
  const fileCount = db.prepare("SELECT COUNT(*) as count FROM files").get()?.count || 59;
  const savings = calculateSavings(telemetry, fileCount, tasks.length);

  return {
    success: true,
    agents,
    posts,
    leases,
    tasks,
    telemetry,
    savings,
    waitingLocksCount: waitingLocks?.count || 0,
    summary: rawStatus
  };
};

export const handlePostFeed = (db, payload = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const author_id = payload.author || payload.author_id || '@developer';
  const message = payload.message || '';
  const channel = payload.channel || 'general';
  const event_type = payload.eventType || payload.event_type || 'broadcast';

  const post = postFeedEvent(db, { author_id, event_type, message, channel });
  return { success: Boolean(post), post };
};

