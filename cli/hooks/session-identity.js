// SessionStart identity: derive '@claude-<sid8>' from the hook payload, export it to later Bash calls
// through $CLAUDE_ENV_FILE, and refresh the agents row (heartbeat). Every step fails open.

import fs from 'node:fs';
import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';
import { everyActingChemxCallCarriesIdentity } from './dispatch-identity.js';
import { registerAgent } from '../team/team-db-agents.js';
import { AGENT_ID_ENV, resolveAgentIdentity, toSessionHandle, isStableIdentity } from '../team/agent-identity.js';
import { isMutatingChemxArgs } from '../team/identity-classification.js';
import { closeQuietly, openExistingTeamDb } from '../team/team-db-readonly.js';
import { teamRootFor } from '../team/coordination-target.js';
import { mapSession } from '../telemetry/call-ledger.js';

export const SESSION_ID_ENV = 'CHEMX_SESSION_ID';
// Only plain ids are written into a sourced shell file; anything else is skipped, never quoted.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

const safeSessionId = (payload) => {
  const sessionId = payload?.session_id;
  const isSafe = typeof sessionId === 'string' && SAFE_SESSION_ID.test(sessionId);
  return isSafe ? sessionId : null;
};

const debugNote = (env, message) => {
  const isDebug = env.CHEMX_HOOK_DEBUG === '1';
  if (isDebug) process.stderr.write(`[session-identity] ${message}\n`);
};

/** The handle this session acts as: CHEMX_AGENT_ID, else the payload's session id, else the env tiers. */
export const sessionIdentity = (payload, env = process.env) => {
  const sessionId = safeSessionId(payload);
  const hasSession = Boolean(sessionId);
  const sessionEnv = hasSession ? { ...env, [SESSION_ID_ENV]: sessionId } : env;
  return resolveAgentIdentity(undefined, sessionEnv);
};

// Subagents (Agent tool, workflows) source the same $CLAUDE_ENV_FILE as their orchestrator, so an
// anonymous chemx call of theirs resolves to the orchestrator's handle (#4562). Guaranteed here: a
// transcript path with a `subagents` directory is recognised, and a chemx call that changes files or
// shared state (claims, locks, writes, commits: team/identity-classification.js) without an identity in
// its own text is named. Reads, gates (test, verify, lint, typecheck) and help need none (K16, #6761).
// Not guaranteed: a subagent whose transcript path has another shape.

/** True for a transcript path inside a `subagents` directory (Agent tool and workflow agents). */
export const isSubagentTranscript = (transcriptPath) => {
  const hasPath = typeof transcriptPath === 'string' && transcriptPath !== '';
  return hasPath && transcriptPath.split(/[\\/]/).includes('subagents');
};

/** True when chemx args (the words after the chemx binary) take a lease, claim, write or commit: a write in identity-classification.js. */
export const isActingChemxArgs = isMutatingChemxArgs;

/** The inherited orchestrator handle a subagent call at this payload would act as, or null. */
export const inheritedOrchestratorHandle = (payload) => {
  // agent_id is the documented marker of a subagent hook call; the transcript path is only a fallback (#4598).
  const hasAgentId = typeof payload?.agent_id === 'string' && payload.agent_id !== '';
  const isSubagent = hasAgentId || isSubagentTranscript(payload?.transcript_path);
  const sessionId = safeSessionId(payload);
  const hasSession = isSubagent && Boolean(sessionId);
  return hasSession ? toSessionHandle(sessionId) : null;
};

/** True when `text` names `handle` as a whole token, so `@sess-role` does not count as `@sess`. */
const namesHandleAtBoundary = (text, handle) => {
  let from = text.indexOf(handle);
  while (from !== -1) {
    const next = text[from + handle.length];
    const endsHandle = next === undefined || !/[A-Za-z0-9_-]/.test(next);
    if (endsHandle) return true;
    from = text.indexOf(handle, from + 1);
  }
  return false;
};

/** True when the command runs a state-changing chemx call and some state-changing chemx call in it names no identity. */
export const hasAnonymousActingCall = (command, inheritedHandle = null) => {
  const text = String(command ?? '');
  const isActing = (parsed) => {
    const invocation = parsed.argv.length > 0 ? resolveInvocation(parsed.argv) : null;
    return invocation !== null && isChemxInvocation(invocation) && isActingChemxArgs(invocation.args);
  };
  const acts = parseShell(text).commands.some(isActing);
  const namesInherited = inheritedHandle !== null && namesHandleAtBoundary(text, inheritedHandle);
  return acts && (namesInherited || !everyActingChemxCallCarriesIdentity(text));
};

export const orchestratorActingReason = (handle) => `chemx identity: this call would act as the orchestrator ${handle}, because subagents inherit its CHEMX_AGENT_ID, so a lease, claim or commit would be attributed to it. `
  + `Set CHEMX_AGENT_ID: prefix the command with \`export CHEMX_AGENT_ID=<your handle>; \` or pass --as=<your handle>. The hook cannot choose your handle for you.`;

const exportSkipReason = (sessionId, env) => {
  const agentId = env[AGENT_ID_ENV];
  const hasAgentId = typeof agentId === 'string' && agentId.trim() !== '';
  if (hasAgentId) return 'agent-id-set';
  const hasSession = Boolean(sessionId);
  if (!hasSession) return 'no-session-id';
  const envFile = env.CLAUDE_ENV_FILE;
  const hasEnvFile = typeof envFile === 'string' && envFile !== '';
  if (!hasEnvFile) return 'no-env-file';
  return null;
};

const exportLines = (existing, handle, sessionId) => {
  const needsNewline = existing !== '' && !existing.endsWith('\n');
  const lead = needsNewline ? '\n' : '';
  return `${lead}export ${AGENT_ID_ENV}=${handle}\nexport ${SESSION_ID_ENV}=${sessionId}\n`;
};

/** Appends the session handle to $CLAUDE_ENV_FILE once; returns { exported, handle?, reason? }. */
export const exportSessionIdentity = (payload, env = process.env) => {
  const sessionId = safeSessionId(payload);
  const skipReason = exportSkipReason(sessionId, env);
  const isSkipped = Boolean(skipReason);
  if (isSkipped) return { exported: false, reason: skipReason };
  const envFile = env.CLAUDE_ENV_FILE;
  const handle = toSessionHandle(sessionId);
  try {
    const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : '';
    const isAlreadyExported = existing.includes(`export ${AGENT_ID_ENV}=`);
    if (isAlreadyExported) return { exported: false, reason: 'already-exported' };
    fs.appendFileSync(envFile, exportLines(existing, handle, sessionId));
    return { exported: true, handle };
  } catch (err) {
    debugNote(env, `env file export skipped: ${err.message}`);
    return { exported: false, reason: 'unwritable' };
  }
};

/**
 * Heartbeat for a known agent, registration for a new one; only in an existing db, never a
 * per-process handle. The db is the one holding root's team rows (#2488), not root's own.
 */
export const touchAgentPresence = (root, identity, { sessionId = null, env = process.env } = {}) => {
  const isStable = Boolean(identity?.id) && isStableIdentity(identity);
  if (!isStable) return false;
  const teamRoot = teamRootFor(root, { env });
  const db = teamRoot ? openExistingTeamDb(teamRoot) : null;
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  try {
    const updated = db.prepare('UPDATE agents SET heartbeat = ? WHERE id = ?').run(Date.now(), identity.id);
    const isKnown = Number(updated.changes) > 0;
    if (!isKnown) registerAgent(db, { id: identity.id, role: 'session', metadata: { sessionId, source: identity.source } });
    // #4465: record session -> handle so later calls without an explicit handle can be attributed.
    if (sessionId) mapSession(db, sessionId, identity.id);
    return true;
  } catch (err) {
    debugNote(env, `agent presence skipped: ${err.message}`);
    return false;
  } finally {
    closeQuietly(db);
  }
};
