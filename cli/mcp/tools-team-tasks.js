import { openIndexDb } from '../search-db.js';
import {
  listTasks, getTask, queryFeed, createTask,
  claimTask, updateTaskStatus, registerAgent, postFeedEvent
} from '../team/team-db.js';
import { completeTaskWithAudit, autoGenerateTasksFromAudit } from '../team/team-triage.js';
import { formatTaskListCard, formatTaskDetailCard } from '../team/team-format.js';
import { enforceSingleSlot, verifyTraceability, generateTaskPermalink } from '../team/team-vds.js';
import { freezeReleaseTrain } from '../team/team-release-train.js';
import { resolveListOptions, selectTaskPage, buildTaskListView } from '../team/task-list-view.js';
import { resolveAgentId } from '../team/agent-identity.js';
import { resolveTaskTier } from '../team/task-tier.js';
import { resolveDependencyStates } from '../team/task-detail-sections.js';

export const handleChemxTeamTask = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  let action = args.action || args.subAction;
  if (!action) {
    action = Boolean(args.title) ? 'add' : 'list';
  }

  if (action === 'list') {
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const rule = args.rule || args.ruleId;
    const listOptions = resolveListOptions({ status: args.status, all: args.all, limit: args.limit });
    const tasks = listTasks(db, { status: listOptions.status, assigned_agent_id: args.agentId, parentId, rule, priority: args.priority });
    const { page, total } = selectTaskPage(tasks, listOptions);
    const view = buildTaskListView(page, total);
    return args.card ? { ...view, card: formatTaskListCard(page) } : view;
  }
  const isShowAction = action === 'show' || action === 'view' || action === 'get';
  if (isShowAction) {
    const task = getTask(db, args.taskId || args.id);
    if (!task) return { error: `Task #${args.taskId || args.id} not found` };
    const events = queryFeed(db, { task_id: args.taskId || args.id });
    const dependencyStates = resolveDependencyStates(db, task);
    return {
      task,
      dependencyStates,
      events,
      activityCount: events.length,
      card: formatTaskDetailCard(task, events, dependencyStates)
    };
  }
  const isCommentAction = action === 'comment' || action === 'post';
  if (isCommentAction) {
    const authorHandle = args.agentId || '@agent';
    registerAgent(db, { id: authorHandle, role: 'contributor' });
    return postFeedEvent(db, {
      author_id: authorHandle,
      task_id: Number(args.taskId || args.id),
      event_type: args.type || 'status_update',
      message: args.message || 'Status update'
    });
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
      target_path: args.targetPath || args.target,
      tier: resolveTaskTier(args.tier, args.targetPath || args.target),
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
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return claimTask(db, args.taskId, agentHandle);
  }
  if (action === 'done' || action === 'complete') {
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, target: args.target || args.targetPath, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens, logPath: args.logPath });
  }
  if (action === 'block') {
    return updateTaskStatus(db, args.taskId, 'blocked', { blockedReason: args.blockedReason || 'Blocked' });
  }
  if (action === 'update') {
    const targetStatus = args.status || 'in_progress';
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    if (targetStatus === 'done' || targetStatus === 'completed') {
      return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, target: args.target || args.targetPath, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens, logPath: args.logPath });
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
  const isSlotAction = action === 'slot' || action === 'vds-slot';
  if (isSlotAction) {
    const taskId = Number(args.taskId || args.id);
    return enforceSingleSlot(db, taskId, args.moscow || 'must', args.priority || args.vdsPriority || 'critical');
  }
  const isTraceAction = action === 'trace';
  if (isTraceAction) {
    const taskId = Number(args.taskId || args.id);
    const permalink = args.url || args.taskUrl || generateTaskPermalink(taskId);
    const check = verifyTraceability(permalink);
    if (!check.valid) return { error: check.error };
    db.prepare('UPDATE agent_tasks SET task_url = ?, updated_at = ? WHERE id = ?').run(check.permalink, Date.now(), taskId);
    postFeedEvent(db, {
      author_id: args.agentId || '@stream_guard',
      task_id: taskId,
      event_type: 'task_traceability_anchored',
      message: `Anchored canonical task permalink: ${check.permalink}`,
      metadata: { permalink: check.permalink }
    });
    return { success: true, taskId, permalink: check.permalink };
  }
  const isFreezeAction = action === 'train_freeze' || action === 'freeze';
  if (isFreezeAction) {
    return freezeReleaseTrain(db, args);
  }
  return { error: `Unknown task action: ${action}` };
};
