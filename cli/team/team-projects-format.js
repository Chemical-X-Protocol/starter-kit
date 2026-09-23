/**
 * Chemical X Protocol: Project Terminal Formatter
 * Renders status cards, conversation history, and budget metrics
 */

export const formatProjectStatusCard = ({ session, messages = [], activeTasks = [], learnings = [] }) => {
  if (!session) return '\n  \x1b[90mNo active project session found. Run "chemx project init <goal>" to start.\x1b[0m\n\n';

  const getStatusColor = (status) => {
    if (status === 'completed') return '\x1b[32m';
    if (status.startsWith('paused')) return '\x1b[33m';
    return '\x1b[36m';
  };
  const statusColor = getStatusColor(session.status);
  const spent = session.budget_spent_usd || 0;
  const limit = session.budget_limit_usd || 2.0;
  const budgetColor = spent >= limit ? '\x1b[31m' : '\x1b[32m';

  const lines = [''];
  lines.push('\x1b[1m\x1b[36m⚡ [Chemical X] Persistent Project Coordinator\x1b[0m');
  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m`);
  lines.push(`  \x1b[1mTitle:\x1b[0m    ${session.title}`);
  lines.push(`  \x1b[1mGoal:\x1b[0m     ${session.goal_description}`);
  lines.push(`  \x1b[1mStatus:\x1b[0m   ${statusColor}[${session.status.toUpperCase()}]\x1b[0m │ Mode: \x1b[1m${session.mode}\x1b[0m`);
  lines.push(`  \x1b[1mTurns:\x1b[0m    ${session.current_turn} / ${session.max_turns} │ Spend: ${budgetColor}$${spent.toFixed(4)}\x1b[0m / $${limit.toFixed(2)} USD`);
  lines.push(`  \x1b[1mBacklog:\x1b[0m  ${activeTasks.length} active task(s) │ Learned rules: \x1b[35m${learnings.length}\x1b[0m`);

  if (activeTasks.length > 0) {
    lines.push('', '  \x1b[1mActive Workload:\x1b[0m');
    for (const t of activeTasks.slice(0, 3)) {
      const assignee = t.assigned_agent_id ? `(${t.assigned_agent_id})` : '(unassigned)';
      lines.push(`    \x1b[36m#${t.id}\x1b[0m [${t.status}] ${assignee}: ${t.title}`);
    }
  }

  if (messages.length > 0) {
    lines.push('', '  \x1b[1mLatest Coordinator Messages:\x1b[0m');
    for (const m of messages.slice(-3)) {
      lines.push(`    \x1b[90m[${m.author_id}]\x1b[0m ${m.message}`);
    }
  }

  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m\n`);
  return lines.join('\n');
};
