/**
 * Chemical X Protocol: Swarm Task DAG Management
 * Handles task lifecycle, claims, dependency verification, and VDS status in SQLite
 */

import {
  normalizeAgentId, parseTaskRow, checkDependenciesMet,
  evaluateClaim, executeStatusUpdate, buildTaskListQuery
} from './team-db-task-helpers.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { generateTaskPermalink } from './team-vds.js';

export const getTask = (db, taskId) => {
  const canGet = Boolean(db) && Boolean(taskId);
  if (!canGet) return null;
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(taskId));
  return parseTaskRow(row);
};

export const areTaskDependenciesMet = (db, taskId) => checkDependenciesMet(db, taskId, getTask);

export const createTask = (db, taskData) => {
  const canCreate = Boolean(db) && Boolean(taskData?.title);
  if (!canCreate) return null;

  const now = Date.now();
  const sql = `INSERT INTO agent_tasks (
    title, description, tier, target_path, target_symbol, status, priority, assigned_agent_id,
    blocked_reason, parent_id, dependencies, created_at, updated_at, result_payload, origin_type,
    rule_id, violation_snapshot, diff_receipt, moscow, vds_priority, vds_phase, vds_status, task_url, sprint_tag
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const info = db.prepare(sql).run(
    taskData.title, taskData.description || '', taskData.tier || '',
    taskData.target_path || null, taskData.target_symbol || '', taskData.status || 'queued',
    Number(taskData.priority || 2), taskData.assigned_agent_id || null,
    taskData.blocked_reason || '', taskData.parent_id || null,
    JSON.stringify(taskData.dependencies || []), now, now,
    JSON.stringify(taskData.result_payload || {}),
    taskData.origin_type || (taskData.target_path ? 'audit' : 'manual'),
    taskData.rule_id || '', JSON.stringify(taskData.violation_snapshot || {}),
    JSON.stringify(taskData.diff_receipt || {}),
    taskData.moscow || 'must', taskData.vds_priority || 'medium',
    taskData.vds_phase || 'planning', taskData.vds_status || 'ready',
    taskData.task_url || '', taskData.sprint_tag || ''
  );
  const createdId = info.lastInsertRowid;
  if (!taskData.task_url) {
    db.prepare('UPDATE agent_tasks SET task_url = ? WHERE id = ?').run(generateTaskPermalink(createdId), createdId);
  }
  return getTask(db, createdId);
};

export const claimTask = (db, taskId, agentId) => {
  const canClaim = Boolean(db) && Boolean(taskId) && Boolean(agentId);
  if (!canClaim) return { success: false, reason: 'missing_args' };

  const cleanId = normalizeAgentId(agentId);
  return withImmediateTransaction(db, () => {
    const task = getTask(db, taskId);
    const depsMet = areTaskDependenciesMet(db, taskId);
    const claimCheck = evaluateClaim(task, cleanId, depsMet);
    if (!claimCheck.allowed) {
      const { allowed, ...failDetails } = claimCheck;
      return { success: false, ...failDetails };
    }

    const now = Date.now();
    const sql = "UPDATE agent_tasks SET assigned_agent_id = ?, status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'queued' AND (assigned_agent_id IS NULL OR assigned_agent_id = ?);";
    const info = db.prepare(sql).run(cleanId, now, Number(taskId), cleanId);
    if (info.changes !== 1) return { success: false, reason: 'already_claimed' };
    db.prepare("UPDATE agents SET current_task_id = ?, status = 'busy' WHERE id = ?").run(Number(taskId), cleanId);
    return { success: true, task: getTask(db, taskId) };
  });
};

export const updateTaskStatus = (db, taskId, status, options = {}) => {
  const canUpdate = Boolean(db) && Boolean(taskId) && Boolean(status);
  if (!canUpdate) return null;

  return withImmediateTransaction(db, () => {
    const task = getTask(db, taskId);
    if (!task) return null;
    executeStatusUpdate(db, taskId, status, options, task);
    return getTask(db, taskId);
  });
};

export const listTasks = (db, filter = {}) => {
  if (!db) return [];
  const { query, params } = buildTaskListQuery(filter);
  return db.prepare(query).all(...params).map(parseTaskRow);
};
