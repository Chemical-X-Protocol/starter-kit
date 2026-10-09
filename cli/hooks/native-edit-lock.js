// Lock gate for Claude's native Edit/Write/MultiEdit/NotebookEdit: deny when another handle holds a
// live chemx team lock on the file (the same read-only findForeignLease that applyEdits uses).
// Identity: $CHEMX_AGENT_ID, else '@claude-' + the first 8 chars of the hook payload's session_id.
// With no identity, or on any error, the edit is allowed (hooks fail open).

import path from 'node:path';
import { findForeignLease } from '../edit-locks.js';
import { NATIVE_EDIT_TOOLS, nativeToolTarget } from './native-tool-policy.js';

export const resolveHookAgentId = (payload, env = process.env) => {
  const fromEnv = String(env.CHEMX_AGENT_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  const session = String(payload?.session_id ?? '').trim();
  return session ? `@claude-${session.slice(0, 8)}` : null;
};

const formatUntil = (expiresAt) => new Date(expiresAt).toISOString().slice(11, 19);

export const lockDenyReason = (file, lease, agentId) => {
  const purpose = lease.purpose ? ` (${lease.purpose})` : '';
  return `chemx lock: ${file} is locked by ${lease.lockedBy}${purpose} until ${formatUntil(lease.expiresAt)} UTC. `
    + `Do not edit it; ask ${lease.lockedBy} or wait for the release, then \`chemx team lock acquire ${file} --as=${agentId}\`.`;
};

/** @returns {{ decision: 'deny', rule: 'native-edit-lock', reason: string, lease: object } | null} */
export const decideEditLock = ({ tool, input = {}, root, cwd, agentId, findLease = findForeignLease }) => {
  const isEditTool = NATIVE_EDIT_TOOLS.has(tool);
  const target = nativeToolTarget(tool, input);
  const canCheck = isEditTool && Boolean(target) && Boolean(agentId);
  if (!canCheck) return null;
  try {
    const absolute = path.resolve(cwd || root, target);
    const lease = findLease(root, absolute, agentId);
    if (!lease) return null;
    const display = path.relative(root, absolute) || absolute;
    return { decision: 'deny', rule: 'native-edit-lock', reason: lockDenyReason(display, lease, agentId), lease };
  } catch {
    return null;
  }
};
