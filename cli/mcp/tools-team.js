import { openIndexDb } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import {
  getSwarmStatus,
  queryFeed,
  postFeedEvent,
  listTasks,
  createTask,
  claimTask,
  updateTaskStatus,
  requestFileLock,
  releaseFileLock,
  getFileLockStatus,
  registerAgent
} from '../team/team-db.js';
import { completeTaskWithAudit, autoGenerateTasksFromAudit } from '../team/team-triage.js';
import { handleError } from '../errors/index.js';

export const handleChemxTeamStatus = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const status = getSwarmStatus(db);
  return {
    agents: status.agents,
    tasks: status.tasks,
    locks: {
      active: status.locks.active,
      waiting: status.locks.waiting,
      leases: toColumnar(status.locks.leases, ['file_path', 'locked_by', 'expires_at'])
    },
    tokens: status.tokens,
    blockedTasks: toColumnar(status.blockedTasks, ['id', 'title', 'assigned_agent_id', 'blocked_reason']),
    recentFeed: toColumnar(status.recentFeed, ['id', 'timestamp', 'author_id', 'event_type', 'message'])
  };
};

export const handleChemxTeamFeed = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const events = queryFeed(db, {
    since_id: args.sinceId,
    thread_id: args.threadId,
    task_id: args.taskId,
    agent_id: args.agentId,
    limit: args.limit
  });
  return toColumnar(events, ['id', 'timestamp', 'author_id', 'recipient_id', 'event_type', 'file_path', 'message']);
};

export const handleChemxTeamPost = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const authorHandle = args.authorId || '@agent';
  registerAgent(db, { id: authorHandle, role: 'contributor' });
  return postFeedEvent(db, {
    message: args.message,
    author_id: authorHandle,
    recipient_id: args.recipientId,
    thread_id: args.threadId,
    task_id: args.taskId,
    file_path: args.filePath,
    event_type: args.eventType
  });
};

export const handleChemxTeamTask = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const action = args.action || 'list';

  if (action === 'list') {
    const tasks = listTasks(db, { status: args.status, assigned_agent_id: args.agentId });
    const col = toColumnar(tasks, ['id', 'title', 'tier', 'status', 'priority', 'assigned_agent_id', 'target_path']);
    return { ...col, total: tasks.length };
  }
  if (action === 'create' || action === 'add') {
    const authorHandle = args.agentId || '@agent';
    registerAgent(db, { id: authorHandle, role: 'contributor' });
    if (args.assignedAgentId) {
      registerAgent(db, { id: args.assignedAgentId, role: 'executor' });
    }
    const task = createTask(db, {
      title: args.title,
      target_path: args.targetPath,
      tier: args.tier || 'molecule',
      priority: args.priority || 2,
      assigned_agent_id: args.assignedAgentId || null
    });
    if (task) {
      postFeedEvent(db, {
        author_id: authorHandle,
        task_id: task.id,
        event_type: 'task_created',
        message: `Created task #${task.id}: ${task.title}`
      });
    }
    return task;
  }
  if (action === 'claim') {
    const agentHandle = args.agentId || '@agent';
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return claimTask(db, args.taskId, agentHandle);
  }
  if (action === 'done' || action === 'complete') {
    const agentHandle = args.agentId || '@agent';
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd });
  }
  if (action === 'block') {
    return updateTaskStatus(db, args.taskId, 'blocked', { blockedReason: args.blockedReason || 'Blocked' });
  }
  if (action === 'triage') {
    return autoGenerateTasksFromAudit(db, { cwd, maxTasks: args.maxTasks || 10 });
  }
  return { error: `Unknown task action: ${action}` };
};

export const handleChemxTeamLock = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const action = args.action || 'status';

  if (action === 'acquire') {
    return requestFileLock(db, args.filePath, args.agentId, {
      purpose: args.purpose,
      ttlMs: args.ttlMs
    });
  }
  if (action === 'release') {
    return releaseFileLock(db, args.filePath, args.agentId);
  }
  if (action === 'status') {
    const status = getFileLockStatus(db, args.filePath);
    return {
      lease: status.lease,
      waiters: toColumnar(status.waiters, ['id', 'agent_id', 'priority', 'status', 'requested_at'])
    };
  }
  return { error: `Unknown lock action: ${action}` };
};

export const handleChemxReportIssue = async (args = {}, cwd = process.cwd()) => {
  const errorObj = new Error(args.error || 'Unknown error');
  if (args.stack) errorObj.stack = args.stack;

  const result = await handleError(errorObj, {
    cwd,
    command: args.command,
    repo: args.repo,
    autoPost: Boolean(args.autoPost),
    labels: args.labels,
    silent: true,
    context: args.context,
    skipFileWrite: true
  });

  return {
    success: true,
    issue: {
      title: result.issue.title,
      body: result.issue.body,
      webUrl: result.issue.webUrl,
      targetRepo: result.issue.targetRepo,
      labels: result.issue.labels
    },
    published: result.publishResult.success,
    publishedUrl: result.publishResult.url,
    issueNumber: result.publishResult.issueNumber,
    savedPath: result.savedPath || null
  };
};
