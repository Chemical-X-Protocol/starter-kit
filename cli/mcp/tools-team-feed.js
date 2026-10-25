import { openTeamContext } from '../team/coordination-db.js';
import { toColumnar } from '../columnar.js';
import { buildFeedFilter, clipEvents } from '../team/team-feed-view.js';
import { scopeStatusToAgent, buildStatusView } from '../team/team-status-view.js';
import {
  getSwarmStatus,
  queryFeed,
  postFeedEvent,
  registerAgent
} from '../team/team-db.js';
import { formatSwarmStatusCard } from '../team/team-format.js';
import { resolveAgentId } from '../team/agent-identity.js';

// blockers: list the blocked tasks (the count is always there). mine: only agentId's open tasks, leases and events.
export const handleChemxTeamStatus = async (args = {}, cwd = process.cwd()) => {
  const { db, refused } = openTeamContext(cwd);
  if (!db) return { error: refused || 'sqlite_unavailable' };
  const swarm = getSwarmStatus(db);
  const status = args.mine ? scopeStatusToAgent(db, swarm, resolveAgentId(args.agentId || args.as)) : swarm;
  const options = { blockers: Boolean(args.blockers) };
  return { ...buildStatusView(status, options), card: formatSwarmStatusCard(status, options) };
};

// Newest 20 events with each message cut to one line; full: whole messages. No sinceId: queryFeed returns
// the newest `limit` events (chronological), not the oldest. type: lock|status|post|task or an exact event type.
export const handleChemxTeamFeed = async (args = {}, cwd = process.cwd()) => {
  const { db, refused } = openTeamContext(cwd);
  if (!db) return { error: refused || 'sqlite_unavailable' };
  const events = queryFeed(db, buildFeedFilter({ since: args.sinceId, thread: args.threadId, task: args.taskId, type: args.type, agent: args.agentId, from: args.from, limit: args.limit }));
  const shown = args.full ? events : clipEvents(events);
  return toColumnar(shown, ['id', 'timestamp', 'author_id', 'recipient_id', 'event_type', 'file_path', 'message']);
};

export const handleChemxTeamPost = async (args = {}, cwd = process.cwd()) => {
  const { db, refused } = openTeamContext(cwd);
  if (!db) return { error: refused || 'sqlite_unavailable' };
  const authorHandle = resolveAgentId(args.authorId || args.as);
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
