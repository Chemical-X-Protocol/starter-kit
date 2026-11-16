/**
 * Chemical X Protocol: chemx verify leaves a verify feed row on the caller's claimed task (#7697).
 * recordVerify(db, { handle, status, scope }) writes nothing when no task resolves.
 * recordVerifyBestEffort opens the coordination db and never throws, so verify never fails on recording.
 */
import { contextTaskId } from './team/context-task.js';

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

export const recordVerifyBestEffort = async (cwd, { handle, status, scope } = {}) => {
  try {
    const hasHandle = Boolean(handle);
    if (!hasHandle) return;
    const { openCommitDb } = await import('./commit/commit-record.js');
    const db = openCommitDb(cwd);
    const hasDb = Boolean(db);
    if (!hasDb) return;
    await recordVerify(db, { handle, status, scope });
  } catch {
    // chemx-allow: best-effort the feed row is a courtesy and must never fail a verify run
  }
};
