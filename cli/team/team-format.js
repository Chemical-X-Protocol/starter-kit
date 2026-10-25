import { formatTaskBriefLines, formatTelemetryLines } from './task-detail-sections.js';
import { describeCreationNote } from './task-brief-view.js';
import { clipText } from './team-feed-view.js';
import { END_OF_CARD, sectionTitle } from './help/shared.js';
import { teamCardHead, teamCardGlobalOptions } from './help/team-card.js';
import { TEAM_CARD_ROWS } from './help/card-rows.js';
import { taskCardHead } from './help/task.js';
import { taskCardActions } from './help/task-actions.js';
import { taskCardOptions } from './help/task-options.js';
import { lockCardHead, lockCardActions, lockCardNotes, lockCardOptions } from './help/lock.js';

// The caller's own slice of the board (team status --mine): open tasks and live leases.
const formatMineLines = (mine) => {
  const lines = ['', `  \x1b[1mMine (${mine.agentId}):\x1b[0m`];
  const hasNothing = mine.tasks.length === 0 && mine.leases.length === 0;
  if (hasNothing) lines.push('    \x1b[90m(no open tasks, no leases)\x1b[0m');
  for (const task of mine.tasks) lines.push(`    \x1b[36m#${task.id}\x1b[0m [${task.status}] ${clipText(task.title)}`);
  for (const lease of mine.leases) lines.push(`    \x1b[35mlease\x1b[0m ${lease.file_path}`);
  return lines;
};

export const formatSwarmStatusCard = (status, { blockers = false } = {}) => {
  const a = status.agents;
  const t = status.tasks;
  const l = status.locks;
  const blockedHint = blockers ? '' : ' (--blockers lists them)';
  const blockedStr = t.blocked > 0 ? `\x1b[31m${t.blocked} blocked\x1b[0m${blockedHint}` : '0 blocked';
  const waiterStr = l.waiting > 0 ? `\x1b[33m${l.waiting} in FIFO queue\x1b[0m` : '0 waiting';
  const lines = [
    '',
    '\x1b[1m\x1b[36m⚡ [Chemical X] Multi-Agent Swarm Control Panel\x1b[0m',
    `\x1b[90m${'─'.repeat(54)}\x1b[0m`,
    `  \x1b[1mAgents:\x1b[0m   ${a.total} total  │ \x1b[32m${a.busy} busy\x1b[0m  │ \x1b[34m${a.idle} idle\x1b[0m  │ \x1b[90m${a.offline} offline\x1b[0m`,
    `  \x1b[1mTasks:\x1b[0m    ${t.total} total  │ \x1b[33m${t.queued} queued\x1b[0m │ \x1b[36m${t.in_progress} in-flight\x1b[0m │ \x1b[32m${t.done} done\x1b[0m │ ${blockedStr}`,
    `  \x1b[1mLocks:\x1b[0m    \x1b[35m${l.active} active lease(s)\x1b[0m  │ ${waiterStr}`
  ];
  for (const lease of (l.leases || [])) {
    lines.push(`    \x1b[90m•\x1b[0m ${lease.file_path} \x1b[35m[${lease.locked_by}]\x1b[0m`);
  }
  const hasTokens = Boolean(status.tokens);
  if (hasTokens) {
    const tok = status.tokens;
    lines.push(`  \x1b[1mTokens:\x1b[0m   ${tok.prompt.toLocaleString()} prompt │ ${tok.completion.toLocaleString()} comp │ ${tok.cached.toLocaleString()} cached │ \x1b[32m$${tok.cost_usd.toFixed(4)} est\x1b[0m`);
  }
  const hasMine = Boolean(status.mine);
  if (hasMine) lines.push(...formatMineLines(status.mine));
  const hasBlockedTasks = blockers && Boolean(status.blockedTasks?.length > 0);
  if (hasBlockedTasks) {
    lines.push('', '  \x1b[1m\x1b[31m⚠ Active Blockers:\x1b[0m');
    for (const bt of status.blockedTasks) {
      lines.push(`    \x1b[31m•\x1b[0m #${bt.id} (${bt.assigned_agent_id || 'unassigned'}): ${bt.title} - \x1b[33m${bt.blocked_reason}\x1b[0m`);
    }
  }
  const hasRecentFeed = Boolean(status.recentFeed?.length > 0);
  if (hasRecentFeed) {
    lines.push('', '  \x1b[1mRecent Activity Feed:\x1b[0m');
    for (const ev of status.recentFeed.slice(0, 4)) {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString();
      lines.push(`    \x1b[90m[${timeStr}]\x1b[0m \x1b[36m${ev.author_id}\x1b[0m \x1b[90m(${ev.event_type})\x1b[0m: ${clipText(ev.message)}`);
    }
  }
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m\n`);
  return lines.join('\n');
};

export const formatFeedTimeline = (events = []) => {
  const hasNoEvents = events.length === 0;
  if (hasNoEvents) {
    return '\n  \x1b[90mNo activity feed entries found.\x1b[0m\n\n';
  }
  const lines = [
    '',
    '\x1b[1m\x1b[36m📡 Chemical X Swarm Feed\x1b[0m',
    `\x1b[90m${'─'.repeat(54)}\x1b[0m`
  ];
  for (const ev of events) {
    const timeStr = new Date(ev.timestamp).toLocaleTimeString();
    const toStr = ev.recipient_id ? ` ➔ \x1b[35m${ev.recipient_id}\x1b[0m` : '';
    lines.push(`  \x1b[90m#${ev.id} [${timeStr}]\x1b[0m \x1b[1m\x1b[36m${ev.author_id}\x1b[0m${toStr} \x1b[90m[${ev.event_type}]\x1b[0m`);
    lines.push(`    ${ev.message}`);
  }
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m\n`);
  return lines.join('\n');
};

export const formatTaskListCard = (tasks = []) => {
  const hasNoTasks = tasks.length === 0;
  if (hasNoTasks) return '  (No tasks found in backlog.)\n';
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const childrenMap = new Map();
  for (const t of tasks) {
    const pid = t.parent_id && taskMap.has(t.parent_id) ? t.parent_id : null;
    const hasPid = childrenMap.has(pid);
    if (!hasPid) childrenMap.set(pid, []);
    childrenMap.get(pid).push(t);
  }
  const lines = [];
  const renderNodes = (parentId, depth) => {
    for (const t of (childrenMap.get(parentId) || [])) {
      const indent = depth > 0 ? '  '.repeat(depth) + '└── ' : '  ';
      const assignee = t.assigned_agent_id ? `(${t.assigned_agent_id})` : '(unassigned)';
      const target = t.target_path ? ` [${t.target_path}]` : '';
      const needs = t.needs ? ` <${t.needs}>` : '';
      lines.push(`${indent}#${t.id} [${t.status}]${needs} ${assignee}${target}: ${t.title}`);
      renderNodes(t.id, depth + 1);
    }
  };
  renderNodes(null, 0);
  return lines.join('\n') + '\n';
};

export const formatMailboxCard = (mailbox) => {
  const hasNoMailbox = !mailbox;
  if (hasNoMailbox) return '  (No mailbox data)\n';
  const lines = [''];
  lines.push(`\x1b[1m\x1b[36m📬 [Chemical X] Mailbox for ${mailbox.agentId}\x1b[0m`);
  lines.push(`\x1b[90m${'-'.repeat(54)}\x1b[0m`);
  lines.push(`  \x1b[1mUnread DMs:\x1b[0m ${mailbox.unreadCount}`);

  const taskRows = mailbox.tasks?.rows || [];
  lines.push(`  \x1b[1mActive Tasks (${taskRows.length}):\x1b[0m`);
  const hasNoTasks = taskRows.length === 0;
  if (hasNoTasks) {
    lines.push('    \x1b[90m(No active tasks)\x1b[0m');
  } else {
    for (const row of taskRows) {
      lines.push(`    \x1b[36m#${row[0]}\x1b[0m [${row[3]}] ${row[1]}`);
    }
  }

  const msgRows = mailbox.messages?.rows || [];
  lines.push(`  \x1b[1mIncoming DMs (${msgRows.length}):\x1b[0m`);
  const hasNoMessages = msgRows.length === 0;
  if (hasNoMessages) {
    lines.push('    \x1b[90m(No direct messages)\x1b[0m');
  } else {
    for (const row of msgRows) {
      const unreadTag = row[5] ? '' : ' \x1b[33m[UNREAD]\x1b[0m';
      lines.push(`    \x1b[90m#${row[0]}\x1b[0m \x1b[35m${row[2]}\x1b[0m${unreadTag}: ${row[6]}`);
    }
  }

  const leaseRows = mailbox.leases?.rows || [];
  lines.push(`  \x1b[1mActive Leases (${leaseRows.length}):\x1b[0m`);
  const hasNoLeases = leaseRows.length === 0;
  if (hasNoLeases) {
    lines.push('    \x1b[90m(No held leases)\x1b[0m');
  } else {
    for (const row of leaseRows) {
      lines.push(`    \x1b[90m•\x1b[0m ${row[0]}`);
    }
  }

  lines.push(`\x1b[90m${'-'.repeat(54)}\x1b[0m\n`);
  return lines.join('\n');
};

export const formatTaskDetailCard = (task, events = [], dependencyStates = [], routeLabel = null) => {
  const hasNoTask = !task;
  if (hasNoTask) return '  (Task not found)\n';
  const lines = [''];
  const statusColors = {
    queued: '\x1b[33mqueued\x1b[0m',
    in_progress: '\x1b[36min_progress\x1b[0m',
    review: '\x1b[35mreview\x1b[0m',
    done: '\x1b[32mdone\x1b[0m',
    completed: '\x1b[32mcompleted\x1b[0m',
    blocked: '\x1b[31mblocked\x1b[0m'
  };
  const statusStr = statusColors[task.status] || task.status;
  const pStr = `P${task.priority || 2}`;
  const tierStr = task.tier ? `[${task.tier}]` : '';

  lines.push(`\x1b[1m\x1b[36m📋 [Chemical X Task #${task.id}]\x1b[0m \x1b[1m${task.title}\x1b[0m`);
  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m`);
  lines.push(`  \x1b[1mStatus:\x1b[0m   ${statusStr} │ \x1b[1mPriority:\x1b[0m ${pStr} │ \x1b[1mTier:\x1b[0m ${tierStr || '(none)'}`);
  lines.push(`  \x1b[1mAssignee:\x1b[0m ${task.assigned_agent_id || '(unassigned)'} │ \x1b[1mOrigin:\x1b[0m ${task.origin_type || 'manual'}`);

  const hasTargetPath = Boolean(task.target_path);
  if (hasTargetPath) {
    lines.push(`  \x1b[1mTarget:\x1b[0m   ${task.target_path}`);
  }
  const hasBlockedReason = Boolean(task.blocked_reason);
  if (hasBlockedReason) {
    lines.push(`  \x1b[1m\x1b[31mBlocker:\x1b[0m  \x1b[33m${task.blocked_reason}\x1b[0m`);
  }
  lines.push(...formatTaskBriefLines(task, dependencyStates, routeLabel));

  lines.push(...formatTelemetryLines(task));

  const isDiffVerified = Boolean(task.diff_receipt?.verified);
  const isResultVerified = Boolean(task.result_payload?.verified);
  const isAstVerified = isDiffVerified || isResultVerified;
  if (isAstVerified) {
    const r = task.diff_receipt?.healthAfter ? task.diff_receipt : task.result_payload;
    lines.push(`  \x1b[32m🛡️ AST Verification:\x1b[0m Clean (Health: ${r.healthAfter ?? 100}/100)`);
  }

  lines.push('', '  \x1b[1mActivity & Status Stream (Asana Timeline):\x1b[0m');
  const hasNoEvents = events.length === 0;
  if (hasNoEvents) {
    lines.push('    \x1b[90m(No updates recorded yet)\x1b[0m');
  } else {
    for (const ev of events) {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString();
      let icon = '•';
      let tag = ev.event_type;
      if (ev.event_type === 'task_created') { icon = '⏳'; tag = 'created'; }
      else if (ev.event_type === 'task_status_updated') { icon = '🔄'; tag = 'status_update'; }
      else if (ev.event_type === 'task_reassigned') { icon = '👤'; tag = 'reassigned'; }
      else if (ev.event_type === 'task_completed') { icon = '✅'; tag = 'completed'; }
      else if (ev.event_type === 'comment' || ev.event_type === 'status_update') { icon = '💬'; tag = 'update'; }

      const isCreation = ev.event_type === 'task_created';
      const creationNote = isCreation ? describeCreationNote(ev, task) : '';
      lines.push(`    \x1b[90m[${timeStr}]\x1b[0m ${icon} \x1b[36m${ev.author_id}\x1b[0m \x1b[90m(${tag})\x1b[0m${creationNote}`);
      if (!isCreation) lines.push(`      ${ev.message}`);
    }
  }

  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m\n`);
  return lines.join('\n');
};
/** `chemx team --help`: each subcommand's rows come from its module in ./help/ (see card-rows.js). */
export const formatTeamHelpCard = () => [
  ...teamCardHead,
  sectionTitle('Commands'),
  ...TEAM_CARD_ROWS,
  '',
  sectionTitle('Global Options'),
  ...teamCardGlobalOptions,
  END_OF_CARD
].join('\n');

/** `chemx team task --help`: the head, Actions and Options rows are in ./help/task.js, task-actions.js and task-options.js. */
export const formatTaskHelpCard = () => [
  ...taskCardHead,
  sectionTitle('Actions'),
  ...taskCardActions,
  '',
  sectionTitle('Options'),
  ...taskCardOptions,
  END_OF_CARD
].join('\n');

/** `chemx team lock --help`: every piece is in ./help/lock.js. */
export const formatLockHelpCard = () => [
  ...lockCardHead,
  '',
  sectionTitle('Actions'),
  ...lockCardActions,
  '',
  ...lockCardNotes,
  '',
  sectionTitle('Options'),
  ...lockCardOptions,
  END_OF_CARD
].join('\n');
