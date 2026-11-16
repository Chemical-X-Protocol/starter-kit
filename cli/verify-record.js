/**
 * Chemical X Protocol: chemx verify leaves a verify feed row on the caller's claimed task (#7697).
 * recordVerify(db, { handle, status, scope }) writes nothing when no task resolves.
 * recordVerifyBestEffort opens the coordination db and never throws, so verify never fails on recording.
 */
import { contextTaskId } from './team/context-task.js';
import { resolveAgentIdentity, isStableIdentity } from './team/agent-identity.js';

/** The handle a verify row may be written for: named by --as, or a session identity. An inherited CHEMX_AGENT_ID is never guessed from; null means write nothing. */
export const verifyHandleFor = (as, env = process.env) => {
  const identity = resolveAgentIdentity(as, env);
  const isStable = isStableIdentity(identity);
  const isInherited = identity.source === 'env';
  const isUsable = isStable && !isInherited;
  return isUsable ? identity.id : null;
};

export const recordVerify = async (db, { handle, status, scope } = {}) => {
  const { postFeedEvent } = await import('./team/team-db.js');
  const taskId = contextTaskId(db, { handle });
  const hasTask = taskId !== null;
  if (!hasTask) return null;
  const label = String(status ?? 'unknown').toUpperCase();
  const dir = scope?.dir || '.';
  const message = `verify ${label} (${dir})`;
  return postFeedEvent(db, { author_id: handle, event_type: 'verify', task_id: taskId, message, metadata: { status, scope } });
};

export const recordVerifyBestEffort = async (cwd, { as, env = process.env, status, scope } = {}) => {
  try {
    const handle = verifyHandleFor(as, env);
    const hasHandle = Boolean(handle);
    if (!hasHandle) return;
    const { openCommitDb } = await import('./commit/commit-record.js');
    const db = openCommitDb(cwd);
    const hasDb = Boolean(db);
    if (!hasDb) return;
    await recordVerify(db, { handle, status, scope });
  } catch (error) {
    // chemx-allow: best-effort the feed row is a courtesy and must never fail a verify run; the error is only logged
    process.stderr.write(`chemx verify: could not record the verify row: ${error?.message ?? error}\n`);
  }
};
