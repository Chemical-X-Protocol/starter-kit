// Group stale chemx MCP servers by project root for the doctor report: which Claude session (id, and
// its transcript when the file exists) or parent process sits behind each, and one restart hint per
// group. Replaces a flat pid list, which says nothing about whose session to restart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_SESSIONS_SHOWN = 3;
const MAX_PARENTS_SHOWN = 3;
const SHORT_ID_LENGTH = 8;
const SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const HINTS = {
  claude: 'restart: run /mcp and reconnect chemical-x in each of those sessions, or end them',
  antigravity: 'restart: reload the Antigravity window for this root, or end its agent session',
  other: 'restart: end the client that launched them',
  mixed: 'restart: end the sessions or editors that launched them',
};

export const defaultClaudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// Claude Code writes <home>/projects/<mangled cwd>/<session id>.jsonl; the id is data from /proc, so
// only a UUID-shaped id is ever joined into a path.
export const findTranscript = (sessionId, claudeHome) => {
  const isUuid = SESSION_ID.test(sessionId);
  const projectsDir = path.join(claudeHome, 'projects');
  const hasProjects = isUuid && fs.existsSync(projectsDir);
  if (!hasProjects) return null;
  for (const name of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const uniqueSorted = (values) => [...new Set(values)].sort();

const hintKey = (processes) => {
  const clients = uniqueSorted(processes.map((proc) => proc.client ?? 'other'));
  return clients.length === 1 ? clients[0] : 'mixed';
};

const describeGroup = (root, processes, reasonOf, claudeHome) => {
  const sessionIds = uniqueSorted(processes.map((proc) => proc.sessionId).filter(Boolean));
  const withoutSession = processes.filter((proc) => !proc.sessionId);
  const parents = uniqueSorted(withoutSession.map((proc) => proc.ppid).filter(Boolean));
  const sessions = sessionIds.map((id) => ({ id, transcript: findTranscript(id, claudeHome) }));
  const clients = uniqueSorted(withoutSession.map((proc) => proc.client).filter(Boolean));
  const reasons = uniqueSorted(processes.map(reasonOf));
  const key = hintKey(processes);
  return { root, count: processes.length, reasons, sessions, others: withoutSession.length, parents, clients, hint: HINTS[key] };
};

// One session is named in full (enough to `claude --resume` it); several are shortened to their first
// 8 characters to keep the line short, and `--json` has every full id.
const sessionPart = (group) => {
  const isSingle = group.sessions.length === 1;
  const shown = group.sessions.slice(0, MAX_SESSIONS_SHOWN).map((session) => (isSingle ? session.id : session.id.slice(0, SHORT_ID_LENGTH)));
  const more = group.sessions.length - shown.length;
  const moreNote = more > 0 ? `, +${more} more` : '';
  const only = isSingle ? group.sessions[0] : null;
  const transcriptNote = only?.transcript ? ` (transcript ${only.transcript})` : '';
  return `${isSingle ? 'session' : 'sessions'} ${shown.join(', ')}${moreNote}${transcriptNote}`;
};

const otherPart = (group, hasSessions) => {
  const label = group.clients.length > 0 ? `${group.clients.join(', ')} editor` : '';
  const none = hasSessions ? `${group.others} without a session id` : 'no session id exposed';
  const parents = group.parents.slice(0, MAX_PARENTS_SHOWN);
  const parentNote = parents.length > 0 ? `; parent pid${parents.length === 1 ? '' : 's'} ${parents.join(', ')}` : '';
  return `${label || none}${parentNote}`;
};

export const groupLines = (group) => {
  const hasSessions = group.sessions.length > 0;
  const hasOthers = group.others > 0;
  const who = [hasSessions ? sessionPart(group) : null, hasOthers ? otherPart(group, hasSessions) : null].filter(Boolean).join('; ');
  return [`${group.count}x ${group.root}: ${group.reasons.join(' + ')}; ${who}`, `   ${group.hint}`];
};

export const groupStaleByRoot = (stale, { reasonOf, claudeHome }) => {
  const byRoot = new Map();
  for (const proc of stale) byRoot.set(proc.root ?? '?', [...(byRoot.get(proc.root ?? '?') ?? []), proc]);
  return [...byRoot].map(([root, processes]) => describeGroup(root, processes, reasonOf, claudeHome));
};
