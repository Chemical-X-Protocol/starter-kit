import { openIndexDb } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import {
  getSwarmStatus,
  queryFeed,
  postFeedEvent,
  registerAgent
} from '../team/team-db.js';
import { formatSwarmStatusCard } from '../team/team-format.js';

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
    recentFeed: toColumnar(status.recentFeed, ['id', 'timestamp', 'author_id', 'event_type', 'message']),
    card: formatSwarmStatusCard(status)
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
