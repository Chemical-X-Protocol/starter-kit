import { openIndexDb } from '../search-db.js';
import {
  listTasks, getTask, queryFeed, createTask,
  claimTask, updateTaskStatus, registerAgent, postFeedEvent
} from '../team/team-db.js';
import { completeTaskWithAudit, autoGenerateTasksFromAudit, reconcileAuditTasks } from '../team/team-triage.js';
import { formatTaskListCard, formatTaskDetailCard } from '../team/team-format.js';
import { enforceSingleSlot, verifyTraceability, generateTaskPermalink } from '../team/team-vds.js';
import { freezeReleaseTrain } from '../team/team-release-train.js';
import { resolveListOptions, selectTaskPage, buildTaskListView } from '../team/task-list-view.js';
import { resolveAgentId } from '../team/agent-identity.js';
import { resolveTaskTier } from '../team/task-tier.js';
import { resolveDependencyStates } from '../team/task-detail-sections.js';
import { checkNeedsInput } from '../team/team-needs.js';

export const handleChemxTeamTask = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) return { error: 'sqlite_unavailable' };
  let action = args.action || args.subAction;
  const hasNoAction = !action;
  if (hasNoAction) {
    action = Boolean(args.title) ? 'add' : 'list';
  }

  const isListAction = action === 'list';
  if (isListAction) {
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const rule = args.rule || args.ruleId;
    const listNeeds = checkNeedsInput(args.needs);
    const hasListNeedsError = Boolean(listNeeds.error);
    if (hasListNeedsError) return { error: listNeeds.error };
    const listOptions = resolveListOptions({ status: args.status, all: args.all, limit: args.limit });
    const tasks = listTasks(db, { status: listOptions.status, assigned_agent_id: args.agentId, parentId, rule, priority: args.priority, needs: listNeeds.needs });
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
  const isCreateAction = action === 'create' || action === 'add';
  if (isCreateAction) {
    const createNeeds = checkNeedsInput(args.needs);
    const hasCreateNeedsError = Boolean(createNeeds.error);
    if (hasCreateNeedsError) return { error: createNeeds.error };
    const authorHandle = args.agentId || '@agent';
    registerAgent(db, { id: authorHandle, role: 'contributor' });
    const hasAssignedAgent = Boolean(args.assignedAgentId);
    if (hasAssignedAgent) {
      registerAgent(db, { id: args.assignedAgentId, role: 'executor' });
    }
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const task = createTask(db, {
      title: args.title,
      target_path: args.targetPath || args.target,
      tier: resolveTaskTier(args.tier, args.targetPath || args.target),
      priority: args.priority || 2,
      needs: createNeeds.needs,
      assigned_agent_id: args.assignedAgentId || null,
      parent_id: parentId ?? null
    });
    const hasTask = Boolean(task);
    if (hasTask) {
      postFeedEvent(db, {
        author_id: authorHandle,
        task_id: task.id,
        event_type: 'task_created',
        message: `Created task #${task.id}: ${task.title}`
      });
    }
    return task;
  }
  const isClaimAction = action === 'claim';
  if (isClaimAction) {
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return claimTask(db, args.taskId, agentHandle);
  }
  const isDoneAction = action === 'done' || action === 'complete';
  if (isDoneAction) {
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, target: args.target || args.targetPath, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens, logPath: args.logPath });
  }
  const isBlockAction = action === 'block';
  if (isBlockAction) {
    return updateTaskStatus(db, args.taskId, 'blocked', { blockedReason: args.blockedReason || 'Blocked' });
  }
  const isUpdateAction = action === 'update';
  if (isUpdateAction) {
    const targetStatus = args.status || 'in_progress';
    const agentHandle = resolveAgentId(args.agentId || args.as);
    registerAgent(db, { id: agentHandle, role: 'executor' });
    const isDoneStatus = targetStatus === 'done' || targetStatus === 'completed';
    if (isDoneStatus) {
      return completeTaskWithAudit(db, args.taskId, agentHandle, { cwd, target: args.target || args.targetPath, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens, logPath: args.logPath });
    }
    return updateTaskStatus(db, args.taskId, targetStatus, { blockedReason: args.blockedReason || '' });
  }
  const isSetTargetAction = action === 'set-target' || action === 'target';
  if (isSetTargetAction) {
    const hasTaskId = Boolean(args.taskId);
    const hasTargetPath = Boolean(args.targetPath);
    const canSet = hasTaskId && hasTargetPath;
    if (!canSet) return { error: 'taskId and targetPath required' };
    db.prepare('UPDATE agent_tasks SET target_path = ?, updated_at = ? WHERE id = ?').run(args.targetPath, Date.now(), Number(args.taskId));
    return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(args.taskId));
  }
  const isTriageAction = action === 'triage';
  if (isTriageAction) {
    return autoGenerateTasksFromAudit(db, { cwd, maxTasks: args.maxTasks || 10 });
  }
  const isReconcileAction = action === 'reconcile' || action === 'prune';
  if (isReconcileAction) {
    return reconcileAuditTasks(db, { cwd });
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
    const isTraceValid = Boolean(check.valid);
    if (!isTraceValid) return { error: check.error };
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
