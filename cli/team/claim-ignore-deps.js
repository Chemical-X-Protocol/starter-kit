import { claimTask, postFeedEvent } from './team-db.js';

// Shared by the CLI and MCP claim paths (#4428). Guarantees: ignoreDeps, when given, must be a non-blank string;
// the feed event is posted only when this claim actually recorded a deps_override. Not guaranteed: any other claim refusal is passed through unchanged.
export const claimWithIgnoreDeps = (db, taskId, agentHandle, ignoreDeps) => {
  const hasFlag = ignoreDeps !== undefined && ignoreDeps !== null;
  const reason = typeof ignoreDeps === 'string' ? ignoreDeps.trim() : '';
  const isReasonMissing = hasFlag && !reason;
  if (isReasonMissing) return { success: false, error: 'ignore-deps reason required: pass a non-empty string reason' };
  const startedAt = Date.now();
  const res = claimTask(db, taskId, agentHandle, hasFlag ? { ignoreDeps: reason } : undefined);
  const override = res.task && res.task.result_payload && res.task.result_payload.deps_override;
  const isRecorded = Boolean(res.success) && Boolean(override) && Number(override.at) >= startedAt;
  if (isRecorded) postFeedEvent(db, { author_id: agentHandle, task_id: Number(taskId), event_type: 'status_update', message: `Claimed #${taskId} ignoring unmet dependencies: ${reason}` });
  return res;
};
