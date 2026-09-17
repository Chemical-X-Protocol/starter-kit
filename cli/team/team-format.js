/**
 * Chemical X Protocol: Swarm Terminal Formatter
 * Ultra-compact, literate ANSI card renders for multi-agent swarm status and feeds
 */

import { ANSI } from '../theme.js';

export const formatSwarmStatusCard = (status) => {
  const lines = [];
  lines.push('');
  lines.push(`\x1b[1m\x1b[36m⚡ [Chemical X] Multi-Agent Swarm Control Panel\x1b[0m`);
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m`);

  // Agents row
  const a = status.agents;
  lines.push(`  \x1b[1mAgents:\x1b[0m   ${a.total} total  │ \x1b[32m${a.busy} busy\x1b[0m  │ \x1b[34m${a.idle} idle\x1b[0m  │ \x1b[90m${a.offline} offline\x1b[0m`);

  // Tasks row
  const t = status.tasks;
  const blockedStr = t.blocked > 0 ? `\x1b[31m${t.blocked} blocked\x1b[0m` : `0 blocked`;
  lines.push(`  \x1b[1mTasks:\x1b[0m    ${t.total} total  │ \x1b[33m${t.queued} queued\x1b[0m │ \x1b[36m${t.in_progress} in-flight\x1b[0m │ \x1b[32m${t.done} done\x1b[0m │ ${blockedStr}`);

  // Locks row
  const l = status.locks;
  const waiterStr = l.waiting > 0 ? `\x1b[33m${l.waiting} in FIFO queue\x1b[0m` : `0 waiting`;
  lines.push(`  \x1b[1mLocks:\x1b[0m    \x1b[35m${l.active} active lease(s)\x1b[0m  │ ${waiterStr}`);

  if (l.leases && l.leases.length > 0) {
    for (const lease of l.leases) {
      lines.push(`    \x1b[90m•\x1b[0m ${lease.file_path} \x1b[35m[${lease.locked_by}]\x1b[0m`);
    }
  }

  // Tokens row
  if (status.tokens) {
    const tok = status.tokens;
    lines.push(`  \x1b[1mTokens:\x1b[0m   ${tok.prompt.toLocaleString()} prompt │ ${tok.completion.toLocaleString()} comp │ ${tok.cached.toLocaleString()} cached │ \x1b[32m$${tok.cost_usd.toFixed(4)} est\x1b[0m`);
  }


  // Blocked tasks alerts
  if (status.blockedTasks && status.blockedTasks.length > 0) {
    lines.push('');
    lines.push(`  \x1b[1m\x1b[31m⚠ Active Blockers:\x1b[0m`);
    for (const bt of status.blockedTasks) {
      lines.push(`    \x1b[31m•\x1b[0m #${bt.id} (${bt.assigned_agent_id || 'unassigned'}): ${bt.title} - \x1b[33m${bt.blocked_reason}\x1b[0m`);
    }
  }

  // Recent feed updates
  if (status.recentFeed && status.recentFeed.length > 0) {
    lines.push('');
    lines.push(`  \x1b[1mRecent Activity Feed:\x1b[0m`);
    for (const ev of status.recentFeed.slice(0, 4)) {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString();
      lines.push(`    \x1b[90m[${timeStr}]\x1b[0m \x1b[36m${ev.author_id}\x1b[0m \x1b[90m(${ev.event_type})\x1b[0m: ${ev.message}`);
    }
  }

  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m`);
  lines.push('');
  return lines.join('\n');
};

export const formatFeedTimeline = (events = []) => {
  if (events.length === 0) {
    return '\n  \x1b[90mNo activity feed entries found.\x1b[0m\n\n';
  }
  const lines = [''];
  lines.push(`\x1b[1m\x1b[36m📡 Chemical X Swarm Feed\x1b[0m`);
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m`);
  for (const ev of events) {
    const timeStr = new Date(ev.timestamp).toLocaleTimeString();
    const toStr = ev.recipient_id ? ` ➔ \x1b[35m${ev.recipient_id}\x1b[0m` : '';
    lines.push(`  \x1b[90m#${ev.id} [${timeStr}]\x1b[0m \x1b[1m\x1b[36m${ev.author_id}\x1b[0m${toStr} \x1b[90m[${ev.event_type}]\x1b[0m`);
    lines.push(`    ${ev.message}`);
  }
  lines.push(`\x1b[90m${'─'.repeat(54)}\x1b[0m\n`);
  return lines.join('\n');
};
