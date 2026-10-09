import { formatTaskBriefLines, formatTelemetryLines } from './task-detail-sections.js';

export const formatSwarmStatusCard = (status) => {
  const a = status.agents;
  const t = status.tasks;
  const l = status.locks;
  const blockedStr = t.blocked > 0 ? `\x1b[31m${t.blocked} blocked\x1b[0m` : '0 blocked';
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
  const hasBlockedTasks = Boolean(status.blockedTasks?.length > 0);
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
      lines.push(`    \x1b[90m[${timeStr}]\x1b[0m \x1b[36m${ev.author_id}\x1b[0m \x1b[90m(${ev.event_type})\x1b[0m: ${ev.message}`);
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

export const formatTaskDetailCard = (task, events = [], dependencyStates = []) => {
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
  lines.push(...formatTaskBriefLines(task, dependencyStates));

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

      lines.push(`    \x1b[90m[${timeStr}]\x1b[0m ${icon} \x1b[36m${ev.author_id}\x1b[0m \x1b[90m(${tag})\x1b[0m`);
      lines.push(`      ${ev.message}`);
    }
  }

  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m\n`);
  return lines.join('\n');
};

export const formatTeamHelpCard = () => {
  const lines = [
    '',
    '\x1b[1m\x1b[36m⚡ [Chemical X] Multi-Agent Swarm Orchestration (team)\x1b[0m',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m`,
    '  \x1b[1mUsage:\x1b[0m chemx team <command> [options]',
    '',
    '  \x1b[1mCommands:\x1b[0m',
    '    \x1b[32mstatus\x1b[0m                   Display swarm agent, task, and lock status card',
    '    \x1b[32mtask\x1b[0m [action]            Manage agent tasks (list, show, add, claim, done, update)',
    '    \x1b[32mlock\x1b[0m [acquire|release]   Acquire or release a mutual exclusion file lock',
    '    \x1b[32munlock\x1b[0m <file>            Release a file lock held by an agent',
    '    \x1b[32mfeed\x1b[0m                     View swarm feed event timeline',
    '    \x1b[32mpost\x1b[0m <message>           Post broadcast message to swarm feed',
    '    \x1b[32minbox\x1b[0m [@agent]           View agent mailbox and notifications',
    '    \x1b[32mdm\x1b[0m <@agent> <msg>        Send direct message to another agent',
    '    \x1b[32mtokens\x1b[0m                   Inspect token consumption and telemetry breakdown',
    '    \x1b[32mtriage\x1b[0m                   Generate tasks automatically from AST audit hazards',
    '    \x1b[32mbenchmark\x1b[0m                Run memory and token reduction ablation benchmark',
    '    \x1b[32mtrain\x1b[0m                    Train/evaluate vector and pattern indices',
    '',
    '  \x1b[1mGlobal Options:\x1b[0m',
    '    \x1b[33m--as\x1b[0m <@agent>            Execute action as specified agent handle',
    '    \x1b[33m--json\x1b[0m                   Output machine-readable JSON format',
    '    \x1b[33m--help, -h\x1b[0m               Show help for team or specific subcommands',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m\n`
  ];
  return lines.join('\n');
};

export const formatTaskHelpCard = () => {
  const lines = [
    '',
    '\x1b[1m\x1b[36m⚡ [Chemical X] Task Coordination Commands (team task)\x1b[0m',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m`,
    '  \x1b[1mUsage:\x1b[0m chemx team task <action> [arguments] [options]',
    '',
    '  \x1b[1mActions:\x1b[0m',
    '    \x1b[32mlist\x1b[0m                         List open tasks, newest 20 (default action)',
    '    \x1b[32mshow\x1b[0m <taskId>                Display full details and activity stream for a task',
    '    \x1b[32madd\x1b[0m "<title>"                Create a new task in the queue',
    '    \x1b[32mclaim\x1b[0m <taskId>              Claim an unassigned task for an agent',
    '    \x1b[32mhandoff\x1b[0m <taskId> <@to>      Pass a task to another agent (assignee or creator only)',
    '    \x1b[32mdone\x1b[0m <taskId>               Complete a task with automatic verification audit',
    '    \x1b[32mupdate\x1b[0m <taskId> [status]    Update task status (in_progress, blocked, done)',
    '    \x1b[32mcomment\x1b[0m <taskId> <msg>       Post a comment or status update to a task',
    '    \x1b[32mtriage\x1b[0m                    Generate tasks from AST architectural hazards',
    '    \x1b[32mreconcile\x1b[0m                 Auto-resolve tasks whose hazards have been fixed',
    '    \x1b[32mset-target\x1b[0m <id> <path>     Assign target file path to a task',
    '    \x1b[32mvds-slot\x1b[0m <id> <moscow> <p> Set MoSCoW slot and priority on a task',
    '    \x1b[32mtrace\x1b[0m <id> <url>            Attach provenance trace URL to a task',
    '',
    '  \x1b[1mOptions:\x1b[0m',
    '    \x1b[33m--as\x1b[0m <@agent>            Agent handle (e.g. @agent-1)',
    '    \x1b[33m--status\x1b[0m <status>        Filter by status (queued, in_progress, review, blocked, done)',
    '    \x1b[33m--all\x1b[0m                    List every status with no row cap',
    '    \x1b[33m--limit\x1b[0m <n>             Rows to show (default 20)',
    '    \x1b[33m--agent\x1b[0m <@agent>         Filter tasks assigned to agent',
    '    \x1b[33m--prio\x1b[0m <1-5>             Task priority filter or setting',
    '    \x1b[33m--needs\x1b[0m <tier>           Capability tier the task needs: light, standard, deep (add sets it, list filters)',
    '    \x1b[33m--force, -f\x1b[0m              Force complete task even with remaining hazards',
    '    \x1b[33m--json\x1b[0m                   Output machine-readable JSON format',
    '    \x1b[33m--help, -h\x1b[0m               Show this help message',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m\n`
  ];
  return lines.join('\n');
};

export const formatLockHelpCard = () => {
  const lines = [
    '',
    '\x1b[1m\x1b[36m⚡ [Chemical X] Mutual Exclusion File Locking (team lock)\x1b[0m',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m`,
    '  \x1b[1mUsage:\x1b[0m chemx team lock [acquire|release|renew|check|status] <filePath> [options]',
    '         chemx team lock list | check-staged [files...]',
    '         chemx team unlock <filePath> [options]',
    '',
    '  \x1b[1mActions:\x1b[0m',
    '    \x1b[32macquire\x1b[0m <path>              Acquire a lease for 5 minutes (or enqueue in FIFO)',
    '    \x1b[32mrelease\x1b[0m <path>              Release the lease and promote the next FIFO waiter;',
    '                                 if it lapsed, says when and who holds the file now',
    '    \x1b[32mrenew\x1b[0m <path>                Extend your own live lease to 5 minutes from now',
    '    \x1b[32mcheck\x1b[0m <path>                Would an edit be refused? exit 0 clear, 2 locked',
    '    \x1b[32mstatus\x1b[0m <path> | \x1b[32mlist\x1b[0m        Show one lease and its waiters, or every live lease',
    '    \x1b[32mcheck-staged\x1b[0m [files]        Pre-commit guard: exit 1 if a staged file is under another',
    '                                 handle\'s live lease (default: the files in git diff --cached)',
    '',
    '  \x1b[1mLeases:\x1b[0m any chemx command run as the holder (--as, CHEMX_AGENT_ID or session) extends',
    '  all of the holder\'s live leases to 5 minutes from then; test, verify, typecheck, build and',
    '  audit keep extending every 2.5 minutes while they run. A lease with no chemx activity',
    '  lapses and the file is free. Details: docs/team-locks.md',
    '',
    '  \x1b[1mOptions:\x1b[0m',
    '    \x1b[33m--as\x1b[0m <@agent>            Agent handle (default: CHEMX_AGENT_ID, then the session handle)',
    '    \x1b[33m--purpose\x1b[0m "<reason>"      Reason or intent for acquiring lock',
    '    \x1b[33m--priority\x1b[0m <1-5>         Priority in FIFO wait queue (1 = highest, default: 2)',
    '    \x1b[33m--pid\x1b[0m <pid>              Optional process PID for crash-recovery lease reclamation',
    '    \x1b[33m--json\x1b[0m                   Output machine-readable JSON format',
    '    \x1b[33m--help, -h\x1b[0m               Show this help message',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m\n`
  ];
  return lines.join('\n');
};
