import { claimTask, postFeedEvent, getTask } from './team-db.js';
import { recordClaimBoard } from './board-claim-record.js';
import { renewHolderLeases } from './lease-activity.js';

// Shared by the CLI and MCP claim paths (#4428). Guarantees: ignoreDeps, when given, must be a non-blank string;
// the feed event is posted only when this claim actually recorded a deps_override; a successful claim made with
// a board ({ root, env }) records that board root on the task, the agent row and the handle's pointer (#6750)
// and renews the handle's leases (#6758).
// Not guaranteed: any other claim refusal is passed through unchanged.
export const claimWithIgnoreDeps = (db, taskId, agentHandle, ignoreDeps, board = null) => {
  const hasFlag = ignoreDeps !== undefined && ignoreDeps !== null;
  const reason = typeof ignoreDeps === 'string' ? ignoreDeps.trim() : '';
  const isReasonMissing = hasFlag && !reason;
  if (isReasonMissing) return { success: false, error: 'ignore-deps reason required: pass a non-empty string reason' };
  const startedAt = Date.now();
  const res = claimTask(db, taskId, agentHandle, hasFlag ? { ignoreDeps: reason } : undefined);
  const override = res.task && res.task.result_payload && res.task.result_payload.deps_override;
  const isRecorded = Boolean(res.success) && Boolean(override) && Number(override.at) >= startedAt;
  if (isRecorded) postFeedEvent(db, { author_id: agentHandle, task_id: Number(taskId), event_type: 'status_update', message: `Claimed #${taskId} ignoring unmet dependencies: ${reason}` });
  const hasBoard = Boolean(board?.root) && Boolean(res.success);
  if (hasBoard) {
    recordClaimBoard(db, taskId, agentHandle, board);
    // The claim is activity too, and the task is in_progress now: extend this handle's leases and bring back one that just lapsed (#6758).
    renewHolderLeases(board.root, agentHandle, { env: board.env });
    return { ...res, task: getTask(db, taskId) };
  }
  return res;
};
