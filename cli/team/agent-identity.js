/**
 * Chemical X Protocol: Agent identity resolution.
 * An explicit handle wins, then CHEMX_AGENT_ID, then a session handle derived from
 * CHEMX_SESSION_ID or CLAUDE_SESSION_ID ('@claude-<first 8 chars>'), then a handle unique to this process.
 * A shared fallback such as '@agent' would let every anonymous caller pass as the same lock holder.
 * A read (identity-classification.js) that finds none of those runs under a derived handle, '@session-<id8>'
 * (K16, #6761): a name for telemetry and for output that must say whose view it is, never a holder. The prefix is
 * reserved: the lease, claim, agent-row and feed primitives refuse it, so a read cannot become a board actor.
 */

import crypto from 'node:crypto';

export const AGENT_ID_ENV = 'CHEMX_AGENT_ID';
export const SESSION_ID_ENVS = ['CHEMX_SESSION_ID', 'CLAUDE_SESSION_ID'];
const SESSION_PREFIX_LENGTH = 8;

export const DERIVED_PREFIX = '@session-';
const DERIVED_LENGTH = 8;
const STABLE_SOURCES = new Set(['explicit', 'env', 'session']);

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

/** True for a handle in the reserved derived namespace, with or without its '@'. */
export const isDerivedHandle = (handle) => {
  const hasHandle = isNonEmptyString(handle);
  return hasHandle && toHandle(handle).startsWith(DERIVED_PREFIX);
};

/** Why a derived handle was refused a lease or a claim. */
export const describeDerivedRefusal = (handle) => `${handle} is a derived handle (the name a read runs under, reserved prefix ${DERIVED_PREFIX}); it holds no lease and claims no task. Name your handle with --as=<@handle> or CHEMX_AGENT_ID.`;

// Stable within a process, and not the process handle writes fall back to.
const getDerivedHandle = () => `${DERIVED_PREFIX}${crypto.createHash('sha256').update(getProcessAgentId()).digest('hex').slice(0, DERIVED_LENGTH)}`;

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

/** The identity a read runs under: the stable tiers of resolveAgentIdentity, else a derived handle in place of the process handle. */
export const resolveReadIdentity = (explicitId, env = process.env) => {
  const identity = resolveAgentIdentity(explicitId, env);
  const isAnonymous = identity.source === 'process';
  return isAnonymous ? { id: getDerivedHandle(), source: 'derived' } : identity;
};

/** True for an identity that may hold leases and claims: named by --as, CHEMX_AGENT_ID or the session, and outside the derived namespace. */
export const isStableIdentity = (identity) => {
  const isStableSource = STABLE_SOURCES.has(identity?.source);
  const hasId = isNonEmptyString(identity?.id);
  return isStableSource && hasId && !isDerivedHandle(identity.id);
};

export const describeIdentityHint = (identity) => {
  const isProcessScoped = identity?.source === 'process';
  if (!isProcessScoped) return '';
  return `acting as ${identity.id} (unique to this process); pass --as=<@handle> or set ${AGENT_ID_ENV} for a stable identity`;
};
