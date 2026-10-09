// SessionStart identity: derive '@claude-<sid8>' from the hook payload, export it to later Bash calls
// through $CLAUDE_ENV_FILE, and refresh the agents row (heartbeat). Every step fails open.

import fs from 'node:fs';
import { registerAgent } from '../team/team-db-agents.js';
import { AGENT_ID_ENV, resolveAgentIdentity, toSessionHandle } from '../team/agent-identity.js';
import { closeQuietly, openExistingTeamDb } from '../team/team-db-readonly.js';

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

/** Heartbeat for a known agent, registration for a new one; only in an existing db, never a per-process handle. */
export const touchAgentPresence = (root, identity, { sessionId = null, env = process.env } = {}) => {
  const isStable = Boolean(identity?.id) && identity.source !== 'process';
  if (!isStable) return false;
  const db = openExistingTeamDb(root);
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  try {
    const updated = db.prepare('UPDATE agents SET heartbeat = ? WHERE id = ?').run(Date.now(), identity.id);
    const isKnown = Number(updated.changes) > 0;
    if (!isKnown) registerAgent(db, { id: identity.id, role: 'session', metadata: { sessionId, source: identity.source } });
    return true;
  } catch (err) {
    debugNote(env, `agent presence skipped: ${err.message}`);
    return false;
  } finally {
    closeQuietly(db);
  }
};
