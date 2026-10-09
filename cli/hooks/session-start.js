// `chemx hook session-start`: a short status card injected at session start (budget: under 300
// tokens). It states facts the agent cannot see (root, version, last grade, ratchet, stale servers)
// and the one-line routing rules the guard enforces, so the first command is already the right one.
// It also exports this session's chemx handle (session-identity.js) and adds a short team brief.

import { collectProjectStatus, formatAge } from './project-status.js';
import { exportSessionIdentity, sessionIdentity, touchAgentPresence } from './session-identity.js';
import { collectTeamBrief, formatTeamBrief } from '../team/team-brief.js';

export const CARD_CHAR_BUDGET = 1100;

export const buildSessionCard = (status) => {
  const lines = [`chemx ${status.version} | root ${status.root}`];
  const audit = status.audit;
  if (audit) lines.push(`Last audit: ${audit.grade} (${audit.score}/100) over ${audit.files ?? '?'} files, ${formatAge(audit.ageMinutes)}; may be a partial scan.`);
  const ratchet = status.ratchet;
  if (ratchet) lines.push(`Ratchet (${ratchet.scope}): ${ratchet.rules} rules, ceiling ${ratchet.ceiling} violations; verify must not rise above it.`);
  const isLaunchBroken = !status.mcpLaunch.ok;
  if (isLaunchBroken) lines.push(`MCP launch: ${status.mcpLaunch.summary}. Run chemx doctor --fix.`);
  const servers = status.servers;
  const hasStale = Boolean(servers?.stale);
  if (hasStale) lines.push(`WARNING: ${servers.stale} chemx MCP server(s) for this root run old code; reconnect with /mcp before trusting MCP results.`);
  const teamBrief = formatTeamBrief(status.team);
  const hasTeamBrief = teamBrief !== '';
  if (hasTeamBrief) lines.push(teamBrief);
  lines.push('Route through chemx: chemx test | typecheck | lint | build -- <cmd> | d | log | read <file> --outline|--symbol=<name>.');
  lines.push('Guard bypass: append `# chemx-bypass: <reason>` (logged as friction). Edit with chemx patch/write (they honour team locks).');
  return lines.join('\n').slice(0, CARD_CHAR_BUDGET);
};

// Identity export, presence and the brief are extras: any failure leaves the base card intact.
const collectTeam = (payload, root, env) => {
  try {
    const identity = sessionIdentity(payload, env);
    exportSessionIdentity(payload, env);
    touchAgentPresence(root, identity, { sessionId: payload?.session_id ?? null, env });
    return collectTeamBrief({ root, agentId: identity.id });
  } catch (err) {
    const isDebug = env.CHEMX_HOOK_DEBUG === '1';
    if (isDebug) process.stderr.write(`[session-start] team brief skipped: ${err.message}\n`);
    return null;
  }
};

export const runSessionStart = async (payload, env = process.env) => {
  const root = env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();
  const status = collectProjectStatus({ root, procRoot: env.CHEMX_PROC_ROOT || '/proc' });
  const team = collectTeam(payload, root, env);
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildSessionCard({ ...status, team }) } };
};
