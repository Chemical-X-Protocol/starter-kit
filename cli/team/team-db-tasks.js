/**
 * Chemical X Protocol: Swarm Task DAG Management
 * Handles task lifecycle, claims, dependency verification, and status in SQLite
 */

import {
  normalizeAgentId,
  parseTaskRow,
  checkDependenciesMet,
  evaluateClaim,
  executeTaskClaim,
  executeStatusUpdate,
  buildTaskListQuery
} from './team-db-task-helpers.js';

export const getTask = (db, taskId) => {
  const hasDb = Boolean(db);
  const hasTaskId = Boolean(taskId);
  const canGet = hasDb && hasTaskId;
  if (!canGet) return null;
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(taskId));
  return parseTaskRow(row);
};

export const areTaskDependenciesMet = (db, taskId) => checkDependenciesMet(db, taskId, getTask);

export const createTask = (db, taskData) => {
  const hasDb = Boolean(db);
  const hasTitle = Boolean(taskData?.title);
  const canCreate = hasDb && hasTitle;
  if (!canCreate) return null;

  const now = Date.now();
  const sql = `INSERT INTO agent_tasks (
    title, description, tier, target_path, target_symbol,
    status, priority, assigned_agent_id, blocked_reason,
    parent_id, dependencies, created_at, updated_at, result_payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const info = db.prepare(sql).run(
    taskData.title, taskData.description || '', taskData.tier || '',
    taskData.target_path || null, taskData.target_symbol || '', taskData.status || 'queued',
    Number(taskData.priority || 2), taskData.assigned_agent_id || null,
    taskData.blocked_reason || '', taskData.parent_id || null,
    JSON.stringify(taskData.dependencies || []), now, now,
    JSON.stringify(taskData.result_payload || {})
  );
  return getTask(db, info.lastInsertRowid);
};

export const claimTask = (db, taskId, agentId) => {
  const hasDb = Boolean(db);
  const hasTaskId = Boolean(taskId);
  const hasAgentId = Boolean(agentId);
  const canClaim = hasDb && hasTaskId && hasAgentId;
  if (!canClaim) return { success: false, reason: 'missing_args' };

  const cleanId = normalizeAgentId(agentId);
  const task = getTask(db, taskId);
  const depsMet = areTaskDependenciesMet(db, taskId);
  const claimCheck = evaluateClaim(task, cleanId, depsMet);
  if (!claimCheck.allowed) {
    const { allowed, ...failDetails } = claimCheck;
    return { success: false, ...failDetails };
  }

  executeTaskClaim(db, taskId, cleanId);
  return { success: true, task: getTask(db, taskId) };
};

export const updateTaskStatus = (db, taskId, status, options = {}) => {
  const hasDb = Boolean(db);
  const hasTaskId = Boolean(taskId);
  const hasStatus = Boolean(status);
  const canUpdate = hasDb && hasTaskId && hasStatus;
  if (!canUpdate) return null;

  const task = getTask(db, taskId);
  const hasTask = Boolean(task);
  if (!hasTask) return null;

  executeStatusUpdate(db, taskId, status, options, task);
  return getTask(db, taskId);
};

export const listTasks = (db, filter = {}) => {
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  const { query, params } = buildTaskListQuery(filter);
  return db.prepare(query).all(...params).map(parseTaskRow);
};
