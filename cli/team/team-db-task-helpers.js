/**
 * Chemical X Protocol: Task DAG Helpers & Validators
 */

export const normalizeAgentId = (id) => {
  const hasId = Boolean(id);
  if (!hasId) return null;
  const isPrefixed = id.startsWith('@');
  return isPrefixed ? id : `@${id}`;
};

export const parseTaskRow = (row) => {
  const hasRow = Boolean(row);
  if (!hasRow) return null;
  return {
    ...row,
    dependencies: JSON.parse(row.dependencies || '[]'),
    result_payload: JSON.parse(row.result_payload || '{}'),
    violation_snapshot: typeof row.violation_snapshot === 'string' ? JSON.parse(row.violation_snapshot || '{}') : (row.violation_snapshot || {}),
    diff_receipt: typeof row.diff_receipt === 'string' ? JSON.parse(row.diff_receipt || '{}') : (row.diff_receipt || {})
  };
};

export const checkDependenciesMet = (db, taskId, getTask) => {
  const task = getTask(db, taskId);
  const hasTask = Boolean(task);
  if (!hasTask) return true;
  const hasDeps = Array.isArray(task.dependencies) && task.dependencies.length > 0;
  if (!hasDeps) return true;

  const placeholders = task.dependencies.map(() => '?').join(',');
  const query = `SELECT COUNT(*) as unfinished FROM agent_tasks WHERE id IN (${placeholders}) AND status != 'done'`;
  const res = db.prepare(query).get(...task.dependencies);
  return Number(res?.unfinished || 0) === 0;
};

export const evaluateClaim = (task, cleanId, isDepsMet) => {
  const hasTask = Boolean(task);
  if (!hasTask) return { allowed: false, reason: 'task_not_found' };

  const isClaimedByOther = task.status === 'in_progress' && Boolean(task.assigned_agent_id) && task.assigned_agent_id !== cleanId;
  if (isClaimedByOther) {
    return { allowed: false, reason: 'already_claimed', claimedBy: task.assigned_agent_id };
  }
  if (!isDepsMet) {
    return { allowed: false, reason: 'dependencies_unmet', dependencies: task.dependencies };
  }
  return { allowed: true };
};

export const executeTaskClaim = (db, taskId, cleanId) => {
  const now = Date.now();
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(cleanId, now, Number(taskId));
  db.prepare('UPDATE agents SET current_task_id = ?, status = ? WHERE id = ?')
    .run(Number(taskId), 'busy', cleanId);
};

export const executeStatusUpdate = (db, taskId, status, options, task) => {
  const now = Date.now();
  const payloadStr = options.resultPayload
    ? JSON.stringify(options.resultPayload)
    : JSON.stringify(task.result_payload);
  const receiptObj = options.diffReceipt || options.resultPayload?.receipt || task.diff_receipt || {};
  const diffReceiptStr = JSON.stringify(receiptObj);
  db.prepare('UPDATE agent_tasks SET status = ?, blocked_reason = ?, result_payload = ?, diff_receipt = ?, updated_at = ? WHERE id = ?')
    .run(status, options.blockedReason || '', payloadStr, diffReceiptStr, now, Number(taskId));

  const isTerminal = ['done', 'failed', 'queued'].includes(status);
  const hasAgent = Boolean(task.assigned_agent_id);
  const shouldReset = isTerminal && hasAgent;
  if (shouldReset) {
    db.prepare('UPDATE agents SET current_task_id = NULL, status = ? WHERE id = ?')
      .run('idle', task.assigned_agent_id);
  }
};

export const buildTaskListQuery = (filter = {}) => {
  let query = 'SELECT * FROM agent_tasks';
  const conditions = [];
  const params = [];
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.assigned_agent_id) {
    conditions.push('assigned_agent_id = ?');
    params.push(normalizeAgentId(filter.assigned_agent_id));
  }
  if (filter.target_path) {
    conditions.push('target_path = ?');
    params.push(filter.target_path);
  }
  const hasConditions = conditions.length > 0;
  if (hasConditions) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY priority ASC, id ASC';
  return { query, params };
};
