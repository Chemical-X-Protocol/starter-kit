import { openIndexDb } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import {
  listTasks,
  createTask,
  claimTask,
  updateTaskStatus,
  registerAgent,
  postFeedEvent
} from '../team/team-db.js';
import { completeTaskWithAudit, autoGenerateTasksFromAudit } from '../team/team-triage.js';
import { formatTaskListCard } from '../team/team-format.js';

export const handleChemxTeamTask = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  const action = args.action || 'list';

  if (action === 'list') {
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const rule = args.rule || args.ruleId;
    const tasks = listTasks(db, { status: args.status, assigned_agent_id: args.agentId, parentId, rule, priority: args.priority });
    const col = toColumnar(tasks, ['id', 'title', 'tier', 'status', 'priority', 'assigned_agent_id', 'target_path', 'parent_id']);
    return { ...col, total: tasks.length, card: formatTaskListCard(tasks) };
  }
  if (action === 'create' || action === 'add') {
    const authorHandle = args.agentId || '@agent';
    registerAgent(db, { id: authorHandle, role: 'contributor' });
    if (args.assignedAgentId) {
      registerAgent(db, { id: args.assignedAgentId, role: 'executor' });
    }
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const task = createTask(db, {
      title: args.title,
      target_path: args.targetPath,
      tier: args.tier || 'molecule',
      priority: args.priority || 2,
      assigned_agent_id: args.assignedAgentId || null,
      parent_id: parentId ?? null
    });
    if (task) {
      postFeedEvent(db, {
        author_id: authorHandle,
        task_id: task.id,
        event_type: 'task_created',
        message: `Created task #${task.id}: ${task.title}`
      });
    }
    return task;
  }
  if (action === 'claim') {
    const agentHandle = args.agentId || '@agent';
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return claimTask(db, args.taskId, agentHandle);
  }
  if (action === 'done' || action === 'complete') {
    const agentHandle = args.agentId || '@agent';
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens });
  }
  if (action === 'block') {
    return updateTaskStatus(db, args.taskId, 'blocked', { blockedReason: args.blockedReason || 'Blocked' });
  }
  if (action === 'update') {
    const targetStatus = args.status || 'in_progress';
    const agentHandle = args.agentId || '@agent';
    registerAgent(db, { id: agentHandle, role: 'executor' });
    if (targetStatus === 'done' || targetStatus === 'completed') {
      return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens });
    }
    return updateTaskStatus(db, args.taskId, targetStatus, { blockedReason: args.blockedReason || '' });
  }
  if (action === 'set-target' || action === 'target') {
    const hasTaskId = Boolean(args.taskId);
    const hasTargetPath = Boolean(args.targetPath);
    const canSet = hasTaskId && hasTargetPath;
    if (!canSet) return { error: 'taskId and targetPath required' };
    db.prepare('UPDATE agent_tasks SET target_path = ?, updated_at = ? WHERE id = ?').run(args.targetPath, Date.now(), Number(args.taskId));
    return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(args.taskId));
  }
  if (action === 'triage') {
    return autoGenerateTasksFromAudit(db, { cwd, maxTasks: args.maxTasks || 10 });
  }
  return { error: `Unknown task action: ${action}` };
};
