/**
 * Chemical X Protocol: Task completion ownership.
 * Only the agent that claimed a task may complete it. An override (--force, or a human
 * operator in the studio) is allowed but always recorded in the completion receipt.
 */

import { normalizeAgentId } from './team-db-task-helpers.js';

const COMPLETABLE_STATUSES = new Set(['in_progress', 'review']);

const describeRefusal = (task, cleanId) => {
  const taskId = task.id;
  const claimHint = `claim it first: chemx team task claim ${taskId} --as=${cleanId}`;
  const isDone = task.status === 'done';
  if (isDone) {
    return { reason: 'already_done', message: `Refusing to complete task #${taskId}: it is already done.` };
  }
  const isUnclaimed = !task.assigned_agent_id;
  if (isUnclaimed) {
    return { reason: 'not_claimed', message: `Refusing to complete task #${taskId}: it is ${task.status} and unclaimed; ${claimHint}` };
  }
  const isOtherAgent = task.assigned_agent_id !== cleanId;
  if (isOtherAgent) {
    return {
      reason: 'not_assignee',
      message: `Refusing to complete task #${taskId}: it is assigned to ${task.assigned_agent_id}, not ${cleanId}. Pass --as=${task.assigned_agent_id} if that is you, or --force to override (recorded in the receipt).`
    };
  }
  return { reason: 'not_in_progress', message: `Refusing to complete task #${taskId}: its status is ${task.status}; ${claimHint}` };
};

export const checkCompletionOwnership = (task, agentId, options = {}) => {
  const cleanId = normalizeAgentId(agentId);
  const isAssignee = Boolean(cleanId) && task.assigned_agent_id === cleanId;
  const isCompletableStatus = COMPLETABLE_STATUSES.has(task.status);
  const isOwned = isAssignee && isCompletableStatus;
  if (isOwned) return { allowed: true, override: null };

  const refusal = describeRefusal(task, cleanId);
  const isOperatorOverride = options.overrideOwnership === true;
  const canOverride = options.force === true || isOperatorOverride;
  if (!canOverride) return { allowed: false, ...refusal };

  const override = {
    by: cleanId,
    via: isOperatorOverride ? 'operator' : 'force',
    reason: refusal.reason,
    previousAssignee: task.assigned_agent_id || null,
    previousStatus: task.status
  };
  return { allowed: true, override };
};

export const buildOwnershipRefusal = (task, ownership) => ({
  refused: true,
  ownership: true,
  reason: ownership.reason,
  taskId: Number(task.id),
  taskTitle: task.title,
  assignedAgentId: task.assigned_agent_id || null,
  status: task.status,
  message: ownership.message
});
