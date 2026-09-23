/**
 * Chemical X Protocol: Swarm Token Telemetry & Feature Breakdown
 * Queries and formats token consumption across agents, tiers, and tasks
 */

export const getSwarmTokenBreakdown = (db) => {
  if (!db) return null;

  const overall = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens), 0) as promptTokens,
      COALESCE(SUM(completion_tokens), 0) as completionTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens,
      COALESCE(SUM(cost_usd), 0) as totalCost,
      COUNT(*) as totalTasks
    FROM agent_tasks
  `).get() || {};

  const byAgent = db.prepare(`
    SELECT
      COALESCE(assigned_agent_id, 'unassigned') as agent,
      COUNT(*) as tasks,
      SUM(total_tokens) as tokens,
      ROUND(SUM(cost_usd), 4) as cost
    FROM agent_tasks
    WHERE total_tokens > 0
    GROUP BY assigned_agent_id
    ORDER BY tokens DESC
    LIMIT 10
  `).all() || [];

  const byTier = db.prepare(`
    SELECT
      COALESCE(NULLIF(tier, ''), 'unspecified') as tier,
      COUNT(*) as tasks,
      SUM(total_tokens) as tokens,
      ROUND(SUM(cost_usd), 4) as cost
    FROM agent_tasks
    GROUP BY tier
    ORDER BY tokens DESC
  `).all() || [];

  const byStatus = db.prepare(`
    SELECT
      status,
      COUNT(*) as tasks,
      COALESCE(SUM(total_tokens), 0) as tokens
    FROM agent_tasks
    GROUP BY status
    ORDER BY tasks DESC
  `).all() || [];

  return { overall, byAgent, byTier, byStatus };
};

export const formatTokenBreakdownCard = (b) => {
  const o = b.overall || {};
  const lines = [
    '',
    '\x1b[1m\x1b[36m⚡ [Chemical X] Swarm Token & Feature Breakdown\x1b[0m',
    `\x1b[90m${'─'.repeat(58)}\x1b[0m`,
    `  \x1b[1mTotal:\x1b[0m   ${(o.totalTokens || 0).toLocaleString()} tokens │ \x1b[32m$${Number(o.totalCost || 0).toFixed(4)}\x1b[0m │ ${o.totalTasks || 0} tasks`,
    `  \x1b[1mDetail:\x1b[0m  ${(o.promptTokens || 0).toLocaleString()} prompt │ ${(o.completionTokens || 0).toLocaleString()} completion`,
    '',
    '  \x1b[1mBy Architectural Tier / Feature:\x1b[0m'
  ];

  for (const t of (b.byTier || [])) {
    const tierName = t.tier.padEnd(14, ' ');
    const count = `${t.tasks} tasks`.padStart(10, ' ');
    const toks = `${(t.tokens || 0).toLocaleString()} toks`.padStart(16, ' ');
    const cost = `$${Number(t.cost || 0).toFixed(2)}`.padStart(8, ' ');
    lines.push(`    \x1b[36m${tierName}\x1b[0m │ ${count} │ ${toks} │ \x1b[32m${cost}\x1b[0m`);
  }

  lines.push('', '  \x1b[1mTop Agents by Token Usage:\x1b[0m');
  for (const a of (b.byAgent || [])) {
    const name = a.agent.padEnd(18, ' ');
    const count = `${a.tasks} tasks`.padStart(10, ' ');
    const toks = `${(a.tokens || 0).toLocaleString()} toks`.padStart(16, ' ');
    const cost = `$${Number(a.cost || 0).toFixed(2)}`.padStart(8, ' ');
    lines.push(`    \x1b[35m${name}\x1b[0m │ ${count} │ ${toks} │ \x1b[32m${cost}\x1b[0m`);
  }

  lines.push('', '  \x1b[1mTask Status Distribution:\x1b[0m');
  for (const s of (b.byStatus || [])) {
    const statusName = s.status.padEnd(14, ' ');
    const count = `${s.tasks} tasks`.padStart(10, ' ');
    const toks = `${(s.tokens || 0).toLocaleString()} toks`.padStart(16, ' ');
    lines.push(`    \x1b[33m${statusName}\x1b[0m │ ${count} │ ${toks}`);
  }

  lines.push(`\x1b[90m${'─'.repeat(58)}\x1b[0m\n`);
  return lines.join('\n');
};
