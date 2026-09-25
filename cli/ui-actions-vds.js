/**
 * Chemical X UI Action Handlers: VDS Slot & Traceability
 */

import { enforceSingleSlot, verifyTraceability, generateTaskPermalink } from './team/team-vds.js';
import { getTask, postFeedEvent } from './team/team-db.js';

export const handleUpdateTaskVdsSlot = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  if (!taskId) return { success: false, error: 'taskId is required' };

  const moscow = body.moscow || 'must';
  const priority = body.priority || body.vds_priority || 'critical';
  const res = enforceSingleSlot(db, taskId, moscow, priority);
  const task = getTask(db, taskId);

  postFeedEvent(db, {
    author_id: '@ui-operator',
    task_id: taskId,
    event_type: 'task_vds_slot_updated',
    message: `Updated task #${taskId} slot to [${moscow.toUpperCase()}/${priority.toUpperCase()}]`,
    metadata: { moscow, priority, displaced: res.displaced }
  });

  return { success: true, ...res, task };
};

export const handleUpdateTaskTraceability = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  if (!taskId) return { success: false, error: 'taskId is required' };

  const url = body.url || body.task_url || generateTaskPermalink(taskId);
  const check = verifyTraceability(url);
  if (!check.valid) return { success: false, error: check.error };

  db.prepare('UPDATE agent_tasks SET task_url = ?, updated_at = ? WHERE id = ?').run(check.permalink, Date.now(), taskId);
  postFeedEvent(db, {
    author_id: '@ui-operator',
    task_id: taskId,
    event_type: 'task_traceability_anchored',
    message: `Anchored task permalink: ${check.permalink}`,
    metadata: { permalink: check.permalink }
  });

  return { success: true, taskId, permalink: check.permalink, task: getTask(db, taskId) };
};
