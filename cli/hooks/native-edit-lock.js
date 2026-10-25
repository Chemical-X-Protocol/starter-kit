// Lock gate for Claude's native Edit/Write/MultiEdit/NotebookEdit: deny when another handle holds a
// live chemx team lock on the file (the same read-only findForeignLease that applyEdits uses).
// Identity: $CHEMX_AGENT_ID, else '@claude-' + the first 8 chars of the hook payload's session_id. A lease
// held by a handle the same agent declared in a chemx call (--as, CHEMX_AGENT_ID) is its own, not foreign
// (declared-identity.js, #6748). With no identity, or on any error, the edit is allowed (hooks fail open).

import path from 'node:path';
import { findForeignLease } from '../edit-locks.js';
import { NATIVE_EDIT_TOOLS, nativeToolTarget } from './native-tool-policy.js';
import { takeoverHint } from '../team/lock-hints.js';

export const resolveHookAgentId = (payload, env = process.env) => {
  const fromEnv = String(env.CHEMX_AGENT_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  const session = String(payload?.session_id ?? '').trim();
  return session ? `@claude-${session.slice(0, 8)}` : null;
};

const formatUntil = (expiresAt) => new Date(expiresAt).toISOString().slice(11, 19);

// A lapsed lease of the editor's own with someone queued behind it reports the first waiter as lockedBy.
const lapsedReason = (file, lease, actor) => `chemx lock: your lease on ${file} lapsed and ${lease.lockedBy} is queued for it, so it is theirs next; this edit was refused. `
  + `Check \`chemx team lock status ${file}\`; when it frees, \`chemx team lock acquire ${file} --as=${actor}\`.`;

/** The refusal text: who holds the file, who you act as, and the exact commands to declare, release, hand over or wait. */
export const lockDenyReason = (file, lease, actor) => {
  if (lease.lapsedOwn) return lapsedReason(file, lease, actor);
  const holder = lease.lockedBy;
  const purpose = lease.purpose ? ` (${lease.purpose})` : '';
  const yours = `Taken as ${holder} from this session? Say so with \`chemx team lock renew ${file} --as=${holder}\` (refused unless it is yours), then edit again.`;
  const theirs = `Not yours: ${takeoverHint({ file, holder, purpose: lease.purpose, actor })}`;
  const locked = `chemx lock: ${file} is locked by ${holder}${purpose} until ${formatUntil(lease.expiresAt)} UTC; this edit was refused. You are acting as ${actor}.`;
  return [locked, yours, theirs].join('\n');
};

// A lease blocks when it is foreign to every handle the editor counts as its own, or when it is the lapsed
// lease of one of them that someone is queued behind (a holder cannot retake it by editing).
const blockingLease = (root, absolute, handles, findLease) => {
  const found = handles.map((handle) => findLease(root, absolute, handle));
  const lapsed = found.find((lease) => lease?.lapsedOwn);
  if (lapsed) return lapsed;
  return found.every(Boolean) ? found[0] : null;
};

/** @returns {{ decision: 'deny', rule: 'native-edit-lock', reason: string, lease: object } | null} */
export const decideEditLock = ({ tool, input = {}, root, cwd, agentId, ownHandles, findLease = findForeignLease }) => {
  const isEditTool = NATIVE_EDIT_TOOLS.has(tool);
  const target = nativeToolTarget(tool, input);
  const handles = ownHandles?.length ? ownHandles : [agentId].filter(Boolean);
  const canCheck = isEditTool && Boolean(target) && handles.length > 0;
  if (!canCheck) return null;
  try {
    const absolute = path.resolve(cwd || root, target);
    const lease = blockingLease(root, absolute, handles, findLease);
    if (!lease) return null;
    const display = path.relative(root, absolute) || absolute;
    return { decision: 'deny', rule: 'native-edit-lock', reason: lockDenyReason(display, lease, handles[0]), lease };
  } catch {
    return null; // chemx-allow: best-effort a lock lookup error never blocks an edit (hooks fail open)
  }
};
