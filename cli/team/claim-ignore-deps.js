import { claimTask, postFeedEvent, getTask, getAgent } from './team-db.js';
import { recordBoardClaim } from './board-claims.js';
import { renewHolderLeases } from './lease-activity.js';

// Writes the board root where the claim lives (#6750): the task's result_payload, the agent row's
// metadata, and the per-handle pointer a commit made from another board's directory follows.
// Not guaranteed: the pointer needs a writable state directory; the two db writes always happen.
const recordClaimBoard = (db, taskId, agentHandle, board) => {
  const task = getTask(db, taskId);
  const payload = { ...(task?.result_payload || {}), board_root: board.root };
  db.prepare('UPDATE agent_tasks SET result_payload = ? WHERE id = ?').run(JSON.stringify(payload), Number(taskId));
  const agent = getAgent(db, agentHandle);
  const metadata = { ...(agent?.metadata || {}), boardRoot: board.root, boardTaskId: Number(taskId) };
  db.prepare('UPDATE agents SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), agent?.id ?? agentHandle);
  recordBoardClaim({ handle: agentHandle, taskId, root: board.root }, { env: board.env });
};

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
