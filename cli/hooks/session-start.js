// `chemx hook session-start`: a short status card injected at session start (budget: under 300
// tokens). It states facts the agent cannot see (root, version, last grade, ratchet, stale servers)
// and the one-line routing rules the guard enforces, so the first command is already the right one.

import { collectProjectStatus, formatAge } from './project-status.js';

export const CARD_CHAR_BUDGET = 1100;

export const buildSessionCard = (status) => {
  const lines = [`chemx ${status.version} | root ${status.root}`];
  const audit = status.audit;
  if (audit) lines.push(`Last audit: ${audit.grade} (${audit.score}/100) over ${audit.files ?? '?'} files, ${formatAge(audit.ageMinutes)}; may be a partial scan.`);
  const ratchet = status.ratchet;
  if (ratchet) lines.push(`Ratchet (${ratchet.scope}): ${ratchet.rules} rules, ceiling ${ratchet.ceiling} violations; verify must not rise above it.`);
  if (!status.mcpLaunch.ok) lines.push(`MCP launch: ${status.mcpLaunch.summary}. Run chemx doctor --fix.`);
  const servers = status.servers;
  const hasStale = Boolean(servers?.stale);
  if (hasStale) lines.push(`WARNING: ${servers.stale} chemx MCP server(s) for this root run old code; reconnect with /mcp before trusting MCP results.`);
  lines.push('Route through chemx: chemx test | typecheck | lint | build -- <cmd> | d | log | read <file> --outline|--symbol=<name>.');
  lines.push('Guard bypass: append `# chemx-bypass: <reason>` (logged as friction). Native Read/Edit are always allowed.');
  return lines.join('\n').slice(0, CARD_CHAR_BUDGET);
};

export const runSessionStart = async (payload, env = process.env) => {
  const root = env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();
  const status = collectProjectStatus({ root, procRoot: env.CHEMX_PROC_ROOT || '/proc' });
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildSessionCard(status) } };
};
