// `chemx hook statusline`: one plain line for the Claude Code status bar: version, last grade,
// ratchet ceiling and stale-server state. No ANSI, so it renders the same in any terminal theme.

import { collectProjectStatus, formatAge } from './project-status.js';

export const buildStatusline = (status) => {
  const parts = [`chemx ${status.version}`];
  const audit = status.audit;
  parts.push(audit ? `grade ${audit.grade} ${audit.score} (${formatAge(audit.ageMinutes)})` : 'grade ?');
  const ratchet = status.ratchet;
  if (ratchet) parts.push(`ratchet ${ratchet.scope}<=${ratchet.ceiling}`);
  const servers = status.servers;
  const hasStale = Boolean(servers?.stale);
  if (hasStale) parts.push(`MCP STALE x${servers.stale}`);
  else {
    const hasRunningServers = Boolean(servers?.running);
    if (hasRunningServers) parts.push(`mcp ok x${servers.running}`);
  }
  const isLaunchOk = Boolean(status.mcpLaunch.ok);
  if (!isLaunchOk) parts.push('launch: run chemx doctor');
  return parts.join(' | ');
};

export const runStatusline = async (payload, env = process.env) => {
  const root = env.CLAUDE_PROJECT_DIR || payload?.workspace?.project_dir || payload?.cwd || process.cwd();
  return buildStatusline(collectProjectStatus({ root, procRoot: env.CHEMX_PROC_ROOT || '/proc' }));
};
