/**
 * Chemical X UI Task & Lock Actions
 * Status updates, agent reassignments, and lock overrides
 */

import { getTask, updateTaskStatus, postFeedEvent } from './team/team-db.js';
import { promoteNextWaiter } from './team/team-db-locks.js';

const formatAgentHandle = (id) => {
  const hasId = Boolean(id);
  if (!hasId) return null;
  const isPrefixed = id.startsWith('@');
  return isPrefixed ? id : `@${id}`;
};

export const handleUpdateTaskStatus = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  const status = body.status;
  const hasTaskId = Boolean(taskId);
  const hasStatus = Boolean(status);
  const isValid = hasTaskId && hasStatus;
  if (!isValid) return { success: false, error: 'taskId and status required' };

  const blockedReason = body.blocked_reason || body.blockedReason || '';
  const agentId = formatAgentHandle(body.agentId || body.agent) || '@ui-operator';
  const updated = updateTaskStatus(db, taskId, status, { blockedReason });
  if (!updated) return { success: false, error: 'Task not found' };

  postFeedEvent(db, {
    author_id: agentId,
    event_type: 'task_status_updated',
    task_id: taskId,
    message: `Task #${taskId} status updated to '${status}'` + (blockedReason ? `: ${blockedReason}` : '')
  });

  return { success: true, task: updated };
};

export const handleAssignTask = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  if (!taskId) return { success: false, error: 'taskId required' };

  const rawAgent = body.assigned_agent_id || body.assignedAgentId || body.agentId || body.agent || null;
  const cleanAgent = formatAgentHandle(rawAgent);
  const now = Date.now();

  db.prepare('UPDATE agent_tasks SET assigned_agent_id = ?, updated_at = ? WHERE id = ?')
    .run(cleanAgent, now, taskId);

  if (cleanAgent) {
    db.prepare('UPDATE agents SET current_task_id = ?, status = ? WHERE id = ?')
      .run(taskId, 'busy', cleanAgent);
  }

  postFeedEvent(db, {
    author_id: '@ui-operator',
    recipient_id: cleanAgent,
    event_type: 'task_reassigned',
    task_id: taskId,
    message: `Task #${taskId} reassigned to ${cleanAgent || 'unassigned'}`
  });

  return { success: true, taskId, assigned_agent_id: cleanAgent, task: getTask(db, taskId) };
};

export const handleOverrideLock = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const filePath = body.filePath || body.path;
  if (!filePath) return { success: false, error: 'filePath is required' };
  const operator = formatAgentHandle(body.agentId || body.agent) || '@ui-operator';

  const existing = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(filePath);
  db.prepare('DELETE FROM file_leases WHERE file_path = ?').run(filePath);

  postFeedEvent(db, {
    author_id: operator,
    event_type: 'lock_override',
    file_path: filePath,
    message: `${operator} overrode lock lease on ${filePath}` + (existing ? ` (held by ${existing.locked_by})` : '')
  });

  const next = promoteNextWaiter(db, filePath);
  const promotedWaiter = next ? next.waiter.agent_id : null;
  return { success: true, overridden: true, filePath, previousHolder: existing?.locked_by || null, promotedWaiter };
};
