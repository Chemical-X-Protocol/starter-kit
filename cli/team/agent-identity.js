/**
 * Chemical X Protocol: Agent identity resolution.
 * An explicit handle wins, then CHEMX_AGENT_ID, then a session handle derived from
 * CHEMX_SESSION_ID or CLAUDE_SESSION_ID ('@claude-<first 8 chars>'), then a handle unique to this process.
 * A shared fallback such as '@agent' would let every anonymous caller pass as the same lock holder.
 */

import crypto from 'node:crypto';

export const AGENT_ID_ENV = 'CHEMX_AGENT_ID';
export const SESSION_ID_ENVS = ['CHEMX_SESSION_ID', 'CLAUDE_SESSION_ID'];
const SESSION_PREFIX_LENGTH = 8;

let processAgentId = null;

const toHandle = (rawId) => {
  const trimmed = String(rawId).trim();
  const isPrefixed = trimmed.startsWith('@');
  return isPrefixed ? trimmed : `@${trimmed}`;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// Only [A-Za-z0-9_-] survives, so the handle is safe in a shell export line and a lock row.
export const toSessionHandle = (sessionId) => {
  const isUsable = isNonEmptyString(sessionId);
  if (!isUsable) return null;
  const prefix = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, SESSION_PREFIX_LENGTH).toLowerCase();
  const hasPrefix = prefix !== '';
  return hasPrefix ? `@claude-${prefix}` : null;
};

const sessionIdFrom = (env) => SESSION_ID_ENVS.map((name) => env[name]).find(isNonEmptyString) ?? null;

export const getProcessAgentId = () => {
  const hasProcessId = Boolean(processAgentId);
  if (hasProcessId) return processAgentId;
  processAgentId = `@agent-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  return processAgentId;
};

export const resolveAgentIdentity = (explicitId, env = process.env) => {
  if (isNonEmptyString(explicitId)) return { id: toHandle(explicitId), source: 'explicit' };
  const envId = env[AGENT_ID_ENV];
  if (isNonEmptyString(envId)) return { id: toHandle(envId), source: 'env' };
  const sessionHandle = toSessionHandle(sessionIdFrom(env));
  const hasSession = Boolean(sessionHandle);
  if (hasSession) return { id: sessionHandle, source: 'session' };
  return { id: getProcessAgentId(), source: 'process' };
};

export const resolveAgentId = (explicitId, env = process.env) => resolveAgentIdentity(explicitId, env).id;

export const describeIdentityHint = (identity) => {
  const isProcessScoped = identity?.source === 'process';
  if (!isProcessScoped) return '';
  return `acting as ${identity.id} (unique to this process); pass --as=<@handle> or set ${AGENT_ID_ENV} for a stable identity`;
};
