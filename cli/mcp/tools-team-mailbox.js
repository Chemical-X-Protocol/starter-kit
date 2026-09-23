import { openIndexDb } from '../search-db.js';
import { getAgentMailbox, sendDirectMessage } from '../team/team-db-mailbox.js';

export const handleChemxTeamInbox = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const agentId = args.agentId || args.agent || args.as || '@agent';
  return getAgentMailbox(db, agentId, {
    since: args.since || args.sinceId,
    limit: args.limit,
    markRead: Boolean(args.markRead)
  });
};

export const handleChemxTeamDm = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const authorId = args.authorId || args.as || '@agent';
  const recipientId = args.recipientId || args.to || args.recipient;
  const hasRecipient = Boolean(recipientId);
  const hasMessage = Boolean(args.message);
  const canSend = hasRecipient && hasMessage;
  if (!canSend) return { error: 'recipientId and message required' };
  return sendDirectMessage(db, {
    author_id: authorId,
    recipient_id: recipientId,
    message: args.message,
    task_id: args.taskId || args.task,
    thread_id: args.threadId || args.thread,
    metadata: args.metadata || {}
  });
};
