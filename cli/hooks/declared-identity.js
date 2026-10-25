// Who a native Edit/Write acts as (#6748). The hook process never sees a subagent's shell export, so
// resolveHookAgentId (native-edit-lock.js) names every agent of a session by the parent session handle
// (@claude-<sid8>): a subagent that leased a file as @sonnet-g3 was refused by its own lease. The Bash
// PreToolUse payload carries session_id, agent_id (subagents only) and the command text together, so a
// chemx call that names an identity (--as, CHEMX_AGENT_ID=, an earlier export) is recorded here as
// (session, agent key) -> handle in the team db, and the next native edit by that agent reads it back.
// Guaranteed: a handle declared by one agent is not applied to a sibling subagent, to the orchestrator of a
// declared subagent, or to another session. Not guaranteed: a lease taken through the MCP tool or a script
// (the PreToolUse matcher has no MCP tools), or by an agent the payload cannot tell apart (agent key empty:
// they then share their declarations, which is the same-session fallback). Declaring a handle needs no more
// trust than `chemx patch --as=<handle>`, which the lock layer already honours. Every step fails open.

import path from 'node:path';
import { chemxCallIdentities } from './dispatch-identity.js';
import { isActingChemxArgs, isSubagentTranscript } from './session-identity.js';
import { teamRootFor } from '../team/coordination-target.js';
import { closeQuietly, openExistingTeamDb, openTeamDbReadOnly, safeAll, safeGet } from '../team/team-db-readonly.js';

const SAFE_KEY = /^[A-Za-z0-9_-]+$/;
const TRANSCRIPT_AGENT = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
// A repeat declaration only rewrites the row after this long, so the latest handle sorts first without a write per call.
const REFRESH_MS = 60 * 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const DDL = `CREATE TABLE IF NOT EXISTS session_agent_handles (
  session_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  handle TEXT NOT NULL,
  declared_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, agent_key, handle)
)`;

const debugNote = (env, message) => {
  const isDebug = env?.CHEMX_HOOK_DEBUG === '1';
  if (isDebug) process.stderr.write(`[declared-identity] ${message}\n`);
};

const sessionOf = (payload) => {
  const sessionId = payload?.session_id;
  const isUsable = typeof sessionId === 'string' && sessionId !== '';
  return isUsable ? sessionId : null;
};

/** The agent a payload came from: its agent_id, else the id in the subagent transcript name, else '' (the main thread). */
export const agentKeyOf = (payload) => {
  const agentId = payload?.agent_id;
  const hasAgentId = typeof agentId === 'string' && SAFE_KEY.test(agentId);
  if (hasAgentId) return agentId;
  const transcript = payload?.transcript_path;
  const named = isSubagentTranscript(transcript) ? path.basename(transcript).match(TRANSCRIPT_AGENT) : null;
  return named ? named[1] : '';
};

// Calls that take, extend or ask about a lease, or change shared state as an identified agent. The gates renew
// leases while they run, so a gate that names a handle declares it too, though it needs none (K16, #6761).
const DECLARING_GATES = new Set(['test', 'verify']);
const isDeclaringArgs = (args) => {
  const isLockCall = args[0] === 'team' && args[1] === 'lock';
  const isGate = DECLARING_GATES.has(args[0]);
  return isActingChemxArgs(args) || isLockCall || isGate;
};

/** The handles the chemx calls in a shell command declare, in order and without repeats. */
export const declaredHandlesIn = (command) => {
  const handles = chemxCallIdentities(command).filter((call) => call.handle !== null && isDeclaringArgs(call.args)).map((call) => call.handle);
  return [...new Set(handles)];
};

const writeDeclaration = (db, { sessionId, key, handle, now }) => {
  const known = safeGet(db, 'SELECT declared_at AS at FROM session_agent_handles WHERE session_id = ? AND agent_key = ? AND handle = ?', [sessionId, key, handle]);
  const isFresh = known !== null && now - Number(known.at) < REFRESH_MS;
  if (isFresh) return 0;
  const isNew = known === null;
  if (isNew) db.prepare('DELETE FROM session_agent_handles WHERE declared_at < ?').run(now - KEEP_MS);
  db.prepare('INSERT INTO session_agent_handles (session_id, agent_key, handle, declared_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, agent_key, handle) DO UPDATE SET declared_at = excluded.declared_at').run(sessionId, key, handle, now);
  return 1;
};

/** Records the handles a Bash payload's chemx calls declare for its (session, agent). Returns how many rows were written. Needs an existing team db. */
export const recordDeclaredHandles = (payload, { root, env = process.env, now = Date.now() } = {}) => {
  const sessionId = sessionOf(payload);
  const isBash = payload?.tool_name === 'Bash';
  const handles = isBash && sessionId ? declaredHandlesIn(payload?.tool_input?.command) : [];
  const hasHandles = handles.length > 0;
  if (!hasHandles) return 0;
  const teamRoot = teamRootFor(root, { env });
  const db = teamRoot ? openExistingTeamDb(teamRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return 0;
  try {
    db.exec(DDL);
    const key = agentKeyOf(payload);
    return handles.reduce((written, handle) => written + writeDeclaration(db, { sessionId, key, handle, now }), 0);
  } catch (err) {
    debugNote(env, `declaration skipped: ${err.message}`);
    return 0;
  } finally {
    closeQuietly(db);
  }
};

/** The handles this payload's (session, agent) declared, latest first; [] when none or no table yet. */
export const readDeclaredHandles = (payload, { root, env = process.env } = {}) => {
  const sessionId = sessionOf(payload);
  if (!sessionId) return [];
  const teamRoot = teamRootFor(root, { env });
  const db = teamRoot ? openTeamDbReadOnly(teamRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  try {
    const rows = safeAll(db, 'SELECT handle FROM session_agent_handles WHERE session_id = ? AND agent_key = ? ORDER BY declared_at DESC, handle', [sessionId, agentKeyOf(payload)]);
    return rows.map((row) => row.handle);
  } finally {
    closeQuietly(db);
  }
};

/**
 * The handles a native edit counts as its own, with the first one as the name it acts under. The main thread
 * keeps its session handle next to what it declared; a subagent that declared (or was dispatched as) a handle
 * is that handle and no longer the orchestrator's session handle it inherits.
 * @returns {{ agentId: string | null, ownHandles: string[] }}
 */
export const editorHandles = ({ base, declared, dispatchHandle = null, isSubagent }) => {
  const own = [...new Set([...declared, dispatchHandle].filter(Boolean))];
  const isSelfNamed = isSubagent && own.length > 0;
  const keepsBase = Boolean(base) && !isSelfNamed;
  const ownHandles = keepsBase ? [...new Set([...own, base])] : own;
  return { agentId: ownHandles[0] ?? null, ownHandles };
};

export const resolveEditorIdentity = (payload, { root, env = process.env, base, dispatchHandle = null }) => {
  const declared = readDeclaredHandles(payload, { root, env });
  const isSubagent = agentKeyOf(payload) !== '';
  return editorHandles({ base, declared, dispatchHandle, isSubagent });
};
