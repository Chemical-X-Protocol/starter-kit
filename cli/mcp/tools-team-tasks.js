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
import { openTeamContext } from '../team/coordination-db.js';
import { resolveTaskRef } from '../team/task-ref.js';
import { resolveListRepo, prepareTaskTarget } from '../team/team-commands-repo.js';
import { repoDir } from '../team/coordination-repos.js';

// Team actions use the coordination db for the call's root (projectRoot), never CHEMX_PROJECT_ROOT's
// (#2426); a task id resolves through task_aliases for the caller's repo (#2488).
const resolveIdArgs = (ctx, args) => {
  const raw = args.taskId ?? args.id;
  const hasRaw = raw !== undefined && raw !== null && raw !== '';
  if (!hasRaw) return { args, notice: null };
  const ref = resolveTaskRef(ctx.db, raw, { repo: ctx.repo });
  const id = ref.id ?? raw;
  return { args: { ...args, taskId: id, id }, notice: ref.notice };
};

const completionOptions = (ctx, args, cwd) => {
  const task = getTask(ctx.db, args.taskId);
  const taskDir = task ? repoDir(ctx.root, task.repo) : cwd;
  return { cwd: taskDir, indexDb: openIndexDb(taskDir) || ctx.db, target: args.target || args.targetPath, force: args.force, noTargetConfirm: args.noTargetConfirm, tokens: args.tokens, logPath: args.logPath };
};

const setTarget = (ctx, args, cwd) => {
  const hasTaskId = Boolean(args.taskId);
  const hasTargetPath = Boolean(args.targetPath);
  const canSet = hasTaskId && hasTargetPath;
  if (!canSet) return { error: 'taskId and targetPath required' };
  const placed = prepareTaskTarget(ctx, cwd, args.targetPath);
  const isRefused = Boolean(placed.error);
  if (isRefused) return { error: placed.error, refused: true };
  ctx.db.prepare('UPDATE agent_tasks SET target_path = ?, repo = ?, updated_at = ? WHERE id = ?').run(placed.target_path, placed.repo, Date.now(), Number(args.taskId));
  return ctx.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(Number(args.taskId));
};

export const handleChemxTeamTask = async (rawArgs = {}, cwd = process.cwd()) => {
  const ctx = openTeamContext(cwd);
  const { db } = ctx;
  if (!db) return { error: ctx.refused || 'sqlite_unavailable' };
  const { args, notice } = resolveIdArgs(ctx, rawArgs);
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
    const repo = resolveListRepo({ allRepos: args.allRepos, repo: args.repo }, ctx);
    const listOptions = resolveListOptions({ status: args.status, all: args.all, limit: args.limit });
    const tasks = listTasks(db, { status: listOptions.status, assigned_agent_id: args.agentId, parentId, rule, priority: args.priority, needs: listNeeds.needs, repo });
    const { page, total } = selectTaskPage(tasks, listOptions);
    // The compact wire view stays as before; repo and board are added only on request (args.scope).
    const baseView = buildTaskListView(page, total);
    const view = args.scope ? { ...baseView, repo: repo ?? null, board: ctx.dbPath } : baseView;
    return args.card ? { ...view, card: formatTaskListCard(page) } : view;
  }
  const isShowAction = action === 'show' || action === 'view' || action === 'get';
  if (isShowAction) {
    const task = getTask(db, args.taskId || args.id);
    if (!task) return { error: `Task #${args.taskId || args.id} not found`, ambiguity: notice };
    const events = queryFeed(db, { task_id: args.taskId || args.id });
    const dependencyStates = resolveDependencyStates(db, task);
    return {
      task,
      dependencyStates,
      events,
      activityCount: events.length,
      ambiguity: notice,
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
    const placed = prepareTaskTarget(ctx, cwd, args.targetPath || args.target);
    const isRefused = Boolean(placed.error);
    if (isRefused) return { error: placed.error, refused: true };
    const authorHandle = args.agentId || '@agent';
    registerAgent(db, { id: authorHandle, role: 'contributor' });
    const hasAssignedAgent = Boolean(args.assignedAgentId);
    if (hasAssignedAgent) {
      registerAgent(db, { id: args.assignedAgentId, role: 'executor' });
    }
    const parentId = args.parentId !== undefined ? args.parentId : args.parent;
    const resolvedParent = parentId === undefined || parentId === null ? parentId : (resolveTaskRef(db, parentId, { repo: ctx.repo }).id ?? parentId);
    const task = createTask(db, {
      title: args.title,
      target_path: placed.target_path,
      repo: placed.repo,
      tier: resolveTaskTier(args.tier, placed.target_path),
      priority: args.priority || 2,
      needs: createNeeds.needs,
      assigned_agent_id: args.assignedAgentId || null,
      parent_id: resolvedParent ?? null
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
    return completeTaskWithAudit(db, args.taskId, agentHandle, completionOptions(ctx, args, cwd));
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
      return completeTaskWithAudit(db, args.taskId, agentHandle, completionOptions(ctx, args, cwd));
    }
    return updateTaskStatus(db, args.taskId, targetStatus, { blockedReason: args.blockedReason || '' });
  }
  const isSetTargetAction = action === 'set-target' || action === 'target';
  if (isSetTargetAction) return setTarget(ctx, args, cwd);
  const isTriageAction = action === 'triage';
  if (isTriageAction) {
    return autoGenerateTasksFromAudit(db, { cwd, maxTasks: args.maxTasks || 10, indexDb: openIndexDb(cwd) || db, root: ctx.root, repo: ctx.repo });
  }
  const isReconcileAction = action === 'reconcile' || action === 'prune';
  if (isReconcileAction) {
    return reconcileAuditTasks(db, { cwd, repo: ctx.repo, root: ctx.root });
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
