import { getSwarmStatus, postFeedEvent } from './team/team-db.js';
import { listRecentTasks } from './ui-paging-tasks.js';
import { listAgentsPage } from './ui-paging-agents.js';
import { calculateSavings, countIndexedFiles } from './ui-actions-helpers.js';
import { getForumCategories, resolveAgentMeta, formatTokenStamp, updateAgentSignatureInDb } from './ui-forum-data.js';
import { getForumTopics, getTopicPosts, createForumTopic } from './ui-forum-topics.js';

const fallbackTelemetry = { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 };

export const getAggregatedTelemetry = (db) => {
  if (!db) return fallbackTelemetry;
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens), 0) as promptTokens,
      COALESCE(SUM(completion_tokens), 0) as completionTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cost_usd), 0) as totalCost
    FROM agent_tasks
  `).get();
  return row || fallbackTelemetry;
};

// The live view rides on every page load and SSE push, so it stays bounded (#7604): the 50 most
// recently touched tasks and seen agents, plus totals. Full lists page through /api/tasks and /api/agents.
export const LIVE_TASK_LIMIT = 50;
export const LIVE_AGENT_LIMIT = 50;

// Team rows come from db; the file count from indexDb, a different db once the team db is shared (#2581).
export const handleSwarmStatus = (db, cwd = process.cwd(), indexDb = db) => {
  if (!db) return { error: 'Database unavailable' };
  const rawStatus = getSwarmStatus(db) || {};
  const rawFeed = db.prepare('SELECT * FROM agent_feed ORDER BY id DESC LIMIT 50').all() || [];
  const rawLocks = db.prepare('SELECT file_path, locked_by, acquired_at, expires_at, purpose FROM file_leases').all() || [];
  const rawWaiters = db.prepare("SELECT id, file_path, agent_id, requested_at, status, priority, purpose FROM file_lock_queue WHERE status = 'waiting'").all() || [];
  const telemetry = getAggregatedTelemetry(db);

  const leases = rawLocks.map((l) => ({
    filePath: l.file_path, lockedBy: l.locked_by, acquiredAt: Number(l.acquired_at), expiresAt: Number(l.expires_at), purpose: l.purpose,
    waitingCount: rawWaiters.filter((w) => w.file_path === l.file_path).length
  }));

  const agentPage = listAgentsPage(db, { limit: LIVE_AGENT_LIMIT }, { leases, posts: rawFeed });
  const agents = agentPage.agents;
  const agentsMap = new Map(agents.map((a) => [a.id, a]));

  const posts = rawFeed.map((f) => {
    const authorMeta = agentsMap.get(f.author_id) || resolveAgentMeta({ id: f.author_id, role: 'general' });
    return {
      id: f.id, author: f.author_id, eventType: f.event_type, message: f.message, timestamp: Number(f.timestamp),
      channel: f.channel, recipient: f.recipient_id, isDirectMessage: Boolean(f.recipient_id),
      tokenStamp: formatTokenStamp(f.message?.length || 50), signature: authorMeta.signature, authorMeta
    };
  });

  const waitingLocks = rawWaiters.map((w) => ({
    id: w.id, filePath: w.file_path, agentId: w.agent_id, requestedAt: Number(w.requested_at), status: w.status, priority: w.priority, purpose: w.purpose
  }));

  const tasks = listRecentTasks(db, LIVE_TASK_LIMIT);
  const taskCounts = rawStatus.tasks || {};
  const tasksTotal = Number(taskCounts.total || 0);

  const fileCount = countIndexedFiles(indexDb) || 59;
  const savings = calculateSavings(telemetry, fileCount, tasksTotal);
  const forumCategories = getForumCategories(db);
  const topics = getForumTopics(db);

  return {
    success: true, agents, agentsTotal: agentPage.total, agentCounts: agentPage.counts, forumCategories, categories: forumCategories,
    topics, posts, leases, waitingLocks, tasks, tasksTotal, taskCounts, telemetry, savings, waitingLocksCount: waitingLocks.length, summary: rawStatus
  };
};

export const handlePostFeed = (db, payload = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const author_id = payload.author || payload.author_id || '@user';
  const message = payload.message || '', channel = payload.channel || 'general';
  const event_type = payload.eventType || payload.event_type || 'broadcast';
  const thread_id = payload.threadId || payload.thread_id || null;
  const task_id = payload.taskId || payload.task_id || null;
  const post = postFeedEvent(db, { author_id, event_type, message, channel, thread_id, task_id });
  return { success: Boolean(post), post };
};

export const handleCreateFeedPost = handlePostFeed;
export const handleGetTopics = (db, catId = null) => ({ success: true, topics: getForumTopics(db, catId) });
export const handleGetTopicPosts = (db, topicId) => ({ success: true, posts: getTopicPosts(db, topicId) });
export const handleCreateTopic = (db, body = {}) => ({ success: true, topic: createForumTopic(db, body) });

export const handleUpdateSignature = (db, body = {}) => {
  const isInvalid = !body.agentId || body.signature === undefined;
  if (isInvalid) return { success: false, error: 'agentId and signature required' };
  return { success: updateAgentSignatureInDb(db, body.agentId, body.signature) };
};
