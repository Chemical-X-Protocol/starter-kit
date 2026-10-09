import { parseNeedsInput } from './team-needs.js';
import { buildHandoffHint } from './team-handoff-hint.js';

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
    moscow: row.moscow || 'must',
    vds_priority: row.vds_priority || 'medium',
    vds_phase: row.vds_phase || 'planning',
    vds_status: row.vds_status || 'ready',
    task_url: row.task_url || '',
    sprint_tag: row.sprint_tag || '',
    needs: row.needs ?? null,
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
    const message = `Task #${task.id} is already claimed by ${task.assigned_agent_id}; ${buildHandoffHint(task.id, task.assigned_agent_id, cleanId)}`;
    return { allowed: false, reason: 'already_claimed', claimedBy: task.assigned_agent_id, message };
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

  const shouldReleaseAgent = Boolean(['done', 'failed', 'queued'].includes(status) && task.assigned_agent_id);
  if (shouldReleaseAgent) {
    db.prepare('UPDATE agents SET current_task_id = NULL, status = ? WHERE id = ?')
      .run('idle', task.assigned_agent_id);
  }
};

export const buildTaskListQuery = (filter = {}) => {
  let query = 'SELECT * FROM agent_tasks';
  const conditions = [];
  const params = [];
  const hasStatusFilter = Boolean(filter.status);
  if (hasStatusFilter) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  const hasAgentFilter = Boolean(filter.assigned_agent_id);
  if (hasAgentFilter) {
    conditions.push('assigned_agent_id = ?');
    params.push(normalizeAgentId(filter.assigned_agent_id));
  }
  const hasTargetPathFilter = Boolean(filter.target_path);
  if (hasTargetPathFilter) {
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
  const ruleFilter = filter.rule || filter.rule_id;
  if (ruleFilter) {
    conditions.push('(rule_id = ? OR rule_id LIKE ?)');
    params.push(ruleFilter, `%${ruleFilter}%`);
  }
  const hasPriority = filter.priority !== undefined && filter.priority !== null && filter.priority !== '';
  if (hasPriority) {
    conditions.push('priority = ?');
    params.push(Number(filter.priority));
  }
  const hasMoscowFilter = Boolean(filter.moscow);
  if (hasMoscowFilter) {
    conditions.push('moscow = ?');
    params.push(filter.moscow);
  }
  const hasVdsPriorityFilter = Boolean(filter.vds_priority);
  if (hasVdsPriorityFilter) {
    conditions.push('vds_priority = ?');
    params.push(filter.vds_priority);
  }
  const needsFilter = parseNeedsInput(filter.needs);
  const hasNeedsFilter = needsFilter !== null;
  if (hasNeedsFilter) {
    conditions.push('needs = ?');
    params.push(needsFilter);
  }
  // repo: one owning package ('.' = the coordination root); absent means every repo.
  const hasRepoFilter = typeof filter.repo === 'string' && filter.repo !== '';
  if (hasRepoFilter) {
    conditions.push('repo = ?');
    params.push(filter.repo);
  }
  const hasSprintTagFilter = Boolean(filter.sprint_tag);
  if (hasSprintTagFilter) {
    conditions.push('sprint_tag = ?');
    params.push(filter.sprint_tag);
  }
  const hasConditions = conditions.length > 0;
  if (hasConditions) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY priority ASC, id ASC';
  return { query, params };
};

// options.schema names where agent_tasks lives on this connection ('main', or an ATTACHed team db);
// options.repo limits the open-task match to one repo; options.insideOnly skips ../ and absolute paths.
export const queryUnassignedHazards = (db, options = {}) => {
  if (!db) return [];
  const tasks = `${options.schema || 'main'}.agent_tasks`;
  const hasRepo = typeof options.repo === 'string';
  const repoClause = hasRepo ? 'AND t.repo = ?' : '';
  const vInside = options.insideOnly ? "AND v.file_path NOT LIKE '../%' AND substr(v.file_path, 1, 1) != '/'" : '';
  const fInside = options.insideOnly ? "AND f.path NOT LIKE '../%' AND substr(f.path, 1, 1) != '/'" : '';
  const query = `
    SELECT 
      COALESCE(v.file_path, f.path) as path,
      COALESCE(f.tier, 'molecule') as tier,
      COALESCE(f.lines, 0) as lines,
      COALESCE(f.health_score, CASE WHEN COUNT(v.id) > 0 THEN MAX(20, 100 - COUNT(v.id) * 15) ELSE 100 END) as health_score,
      COALESCE(MAX(f.hazard_count, COUNT(v.id)), COUNT(v.id)) as hazard_count,
      COUNT(v.id) as violation_count,
      GROUP_CONCAT(DISTINCT v.rule) as rules_summary
    FROM violations v
    LEFT JOIN files f ON f.path = v.file_path
    LEFT JOIN ${tasks} t ON t.target_path = v.file_path AND t.status IN ('queued', 'in_progress', 'review') ${repoClause}
    WHERE t.id IS NULL ${vInside}
    GROUP BY v.file_path
    UNION
    SELECT
      f.path,
      f.tier,
      f.lines,
      f.health_score,
      f.hazard_count,
      f.hazard_count as violation_count,
      'ARCHITECTURAL_HAZARD' as rules_summary
    FROM files f
    LEFT JOIN ${tasks} t ON t.target_path = f.path AND t.status IN ('queued', 'in_progress', 'review') ${repoClause}
    WHERE (f.health_score < 90 OR f.hazard_count > 0)
      AND t.id IS NULL ${fInside}
      AND f.path NOT IN (SELECT file_path FROM violations)
    GROUP BY f.path
    ORDER BY health_score ASC, hazard_count DESC
  `;
  const params = hasRepo ? [options.repo, options.repo] : [];
  try {
    return db.prepare(query).all(...params);
  } catch {
    return [];
  }
};
