export const normalizeAgentId = (id) => {
  if (!id) return null;
  return id.startsWith('@') ? id : `@${id}`;
};

export const parseTaskRow = (row) => {
  if (!row) return null;
  const parseJson = (val, fallback) => {
    if (!val) return fallback;
    return typeof val === 'string' ? JSON.parse(val) : val;
  };
  return {
    ...row,
    dependencies: parseJson(row.dependencies, []),
    result_payload: parseJson(row.result_payload, {}),
    violation_snapshot: parseJson(row.violation_snapshot, {}),
    diff_receipt: parseJson(row.diff_receipt, {})
  };
};

export const checkDependenciesMet = (db, taskId, getTask) => {
  const task = getTask(db, taskId);
  if (!task) return true;
  const hasDeps = Array.isArray(task.dependencies) && task.dependencies.length > 0;
  if (!hasDeps) return true;

  const placeholders = task.dependencies.map(() => '?').join(',');
  const query = `SELECT COUNT(*) as unfinished FROM agent_tasks WHERE id IN (${placeholders}) AND status != 'done'`;
  const res = db.prepare(query).get(...task.dependencies);
  return Number(res?.unfinished || 0) === 0;
};

export const evaluateClaim = (task, cleanId, isDepsMet) => {
  if (!task) return { allowed: false, reason: 'task_not_found' };
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
  const payloadStr = JSON.stringify(options.resultPayload || task.result_payload || {});
  const receiptObj = options.diffReceipt || options.resultPayload?.receipt || task.diff_receipt || {};
  db.prepare('UPDATE agent_tasks SET status = ?, blocked_reason = ?, result_payload = ?, diff_receipt = ?, updated_at = ? WHERE id = ?')
    .run(status, options.blockedReason || '', payloadStr, JSON.stringify(receiptObj), now, Number(taskId));

  if (['done', 'failed', 'queued'].includes(status) && task.assigned_agent_id) {
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
  const parentId = filter.parentId !== undefined ? filter.parentId : filter.parent_id;
  const isRoot = parentId === 'root' || parentId === null;
  const isNumberType = typeof parentId === 'number';
  const isNumericStr = typeof parentId === 'string' && Boolean(parentId) && !isNaN(Number(parentId));
  const isNumeric = isNumberType || isNumericStr;
  if (isRoot) {
    conditions.push('parent_id IS NULL');
  } else if (isNumeric) {
    conditions.push('parent_id = ?');
    params.push(Number(parentId));
  }
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY priority ASC, id ASC';
  return { query, params };
};
