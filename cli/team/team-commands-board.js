/**
 * Chemical X Protocol: board-wide team commands (status, tokens, feed, post, inbox, dm, benchmark).
 * Split out of team-commands.js; each handler takes the already-opened team db.
 */
import { toColumnar } from '../columnar.js';
import { getSwarmStatus, queryFeed, postFeedEvent } from './team-db.js';
import { getAgentMailbox, sendDirectMessage } from './team-db-mailbox.js';
import { formatSwarmStatusCard, formatFeedTimeline, formatMailboxCard } from './team-format.js';
import { getSwarmTokenBreakdown, formatTokenBreakdownCard } from './team-tokens.js';
import { runAblationComparison, formatAblationCard } from './team-memory.js';

const writeOut = (isCli, text) => {
  if (isCli) process.stdout.write(text);
};

const writeJsonOrCard = (value, flags, isCli, formatCard) => {
  const text = flags.isJson ? `${JSON.stringify(value, null, 2)}\n` : formatCard(value);
  writeOut(isCli, text);
  return value;
};

const runStatus = (db, flags, isCli) => {
  const status = getSwarmStatus(db);
  if (!flags.isJson) return writeJsonOrCard(status, flags, isCli, formatSwarmStatusCard);
  const output = {
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
  return writeJsonOrCard(output, flags, isCli, null);
};

const runFeed = (db, flags, isCli) => {
  const events = queryFeed(db, {
    since_id: flags.since,
    thread_id: flags.thread,
    task_id: flags.task,
    event_type: flags.type,
    agent_id: flags.agent
  });
  if (!flags.isJson) return writeJsonOrCard(events, flags, isCli, formatFeedTimeline);
  const col = toColumnar(events, ['id', 'timestamp', 'author_id', 'recipient_id', 'event_type', 'file_path', 'message']);
  return writeJsonOrCard(col, flags, isCli, null);
};

const runPost = (db, flags, positionals, isCli) => {
  const ev = postFeedEvent(db, {
    author_id: flags.as || '@agent',
    recipient_id: flags.to || null,
    thread_id: flags.thread || null,
    task_id: flags.task || null,
    event_type: flags.type || 'broadcast',
    message: positionals.join(' ') || 'Status check',
    metadata: flags.metadata || {}
  });
  const text = flags.isJson ? `${JSON.stringify(ev, null, 2)}\n` : `\x1b[32m✔\x1b[0m Posted event #${ev.id} to feed\n`;
  writeOut(isCli, text);
  return ev;
};

const runInbox = (db, flags, positionals, isCli) => {
  const agentId = flags.agent || flags.as || positionals[0] || '@agent';
  const mailbox = getAgentMailbox(db, agentId, { since: flags.since, limit: flags.limit, markRead: flags.markRead });
  return writeJsonOrCard(mailbox, flags, isCli, formatMailboxCard);
};

const runDm = (db, flags, positionals, isCli) => {
  const to = flags.to || positionals[0];
  const msg = flags.to ? positionals.join(' ') : positionals.slice(1).join(' ');
  const canSend = Boolean(to) && Boolean(msg);
  if (!canSend) {
    if (isCli) process.stderr.write('\x1b[31m✕ Usage: chemx team dm <@recipient> <message>\x1b[0m\n');
    return { error: 'Recipient and message required' };
  }
  const res = sendDirectMessage(db, {
    author_id: flags.as || '@agent',
    recipient_id: to,
    message: msg,
    task_id: flags.task || null,
    thread_id: flags.thread || null,
    metadata: flags.metadata || {}
  });
  const text = flags.isJson ? `${JSON.stringify(res, null, 2)}\n` : `\x1b[32m✔\x1b[0m Sent DM #${res.id} to ${res.recipient_id}\n`;
  writeOut(isCli, text);
  return res;
};

const BOARD_COMMANDS = {
  status: (db, flags, positionals, isCli) => runStatus(db, flags, isCli),
  tokens: (db, flags, positionals, isCli) => writeJsonOrCard(getSwarmTokenBreakdown(db), flags, isCli, formatTokenBreakdownCard),
  feed: (db, flags, positionals, isCli) => runFeed(db, flags, isCli),
  post: runPost,
  inbox: runInbox,
  dm: runDm,
  benchmark: (db, flags, positionals, isCli) => writeJsonOrCard(runAblationComparison(db), flags, isCli, formatAblationCard)
};

const BOARD_ALIASES = { telemetry: 'tokens', ablation: 'benchmark', memory: 'benchmark' };

const canonicalBoardCommand = (subCommand) => {
  const name = Object.hasOwn(BOARD_ALIASES, subCommand) ? BOARD_ALIASES[subCommand] : subCommand;
  return Object.hasOwn(BOARD_COMMANDS, name) ? name : null;
};

/** True when subCommand is one of the board commands above. */
export const isBoardCommand = (subCommand) => canonicalBoardCommand(subCommand) !== null;

export const runBoardCommand = (db, subCommand, flags, positionals, isCli) => {
  const handler = BOARD_COMMANDS[canonicalBoardCommand(subCommand)];
  return handler(db, flags, positionals, isCli);
};
