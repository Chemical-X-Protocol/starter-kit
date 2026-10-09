/**
 * Chemical X Protocol: `chemx team task <action>` (split out of team-commands.js, #2488).
 * Every handler receives the team context (db, root, repo, mode) and positionals whose task id
 * was already resolved through task_aliases (team-commands-repo.js).
 */
import { openIndexDb } from '../search-db.js';
import { listTasks, getTask, createTask, claimTask, updateTaskStatus, registerAgent, postFeedEvent, queryFeed } from './team-db.js';
import { completeTaskWithAudit, reconcileAuditTasks } from './team-triage.js';
import { formatTaskListCard, formatTaskDetailCard, formatTaskHelpCard } from './team-format.js';
import { resolveListOptions, selectTaskPage, buildTaskListView } from './task-list-view.js';
import { handleTaskHandoffCommand } from './team-task-handoff.js';
import { handleTaskCloseCommand, duplicateLinks, formatDuplicateLinks } from './team-task-close.js';
import { handleTaskSlotCommand, handleTaskTraceCommand } from './team-commands-vds.js';
import { resolveCliAgent } from './team-commands-lock.js';
import { resolveTaskTier } from './task-tier.js';
import { resolveDependencyStates } from './task-detail-sections.js';
import { buildCompletionOptions, describeCompletion, describeStatusUpdate, writeTaskResult } from './task-completion-output.js';
import { refuseUnknownTask } from './team-task-guard.js';
import { checkNeedsInput } from './team-needs.js';
import { resolveListRepo, prepareTaskTarget, describeBoardScope } from './team-commands-repo.js';
import { runTriage } from './team-commands-triage.js';
import { repoDir } from './coordination-repos.js';
import { loadModelRouting } from './team-dispatch.js';
import { buildLabelFor } from './team-route.js';

export const TASK_ACTIONS = ['list', 'show', 'add', 'claim', 'handoff', 'close', 'done', 'update', 'comment', 'triage', 'reconcile', 'set-target', 'vds-slot', 'trace'];

const fail = (isCli, message, result = { error: message }) => {
  if (isCli) process.stderr.write(`\x1b[31m✕ ${message}\x1b[0m\n`);
  return result;
};

const writeJsonOr = (value, flags, isCli, line) => {
  if (!isCli) return value;
  const text = flags.isJson ? `${JSON.stringify(value, null, 2)}\n` : line;
  process.stdout.write(text);
  return value;
};

const runList = (ctx, flags, isCli) => {
  const listNeeds = checkNeedsInput(flags.needs);
  const hasListNeedsError = Boolean(listNeeds.error);
  if (hasListNeedsError) return fail(isCli, listNeeds.error);
  const repo = resolveListRepo(flags, ctx);
  const listOptions = resolveListOptions({ status: flags.status, all: flags.all, limit: flags.limit });
  const tasks = listTasks(ctx.db, {
    status: listOptions.status, assigned_agent_id: flags.agent, parentId: flags.parent, rule: flags.rule,
    priority: flags.priority, sprint_tag: flags.sprint, moscow: flags.moscow, needs: listNeeds.needs, repo
  });
  const { page, total } = selectTaskPage(tasks, listOptions);
  if (flags.isJson) {
    const view = { ...buildTaskListView(page, total), repo: repo ?? null, board: ctx.dbPath };
    if (isCli) process.stdout.write(`${JSON.stringify(view)}\n`);
    return view;
  }
  if (isCli) {
    process.stdout.write(formatTaskListCard(page));
    const hasMore = total > page.length;
    if (hasMore) process.stdout.write(`\x1b[2mShowing ${page.length} of ${total}. Use --all, --status=, or --limit= for more.\x1b[0m\n`);
    process.stdout.write(`\x1b[2m${describeBoardScope(ctx, repo)} | --all-repos or --repo=<path> widens it\x1b[0m\n`);
  }
  return page;
};

const runShow = (ctx, taskId, flags, isCli) => {
  if (!taskId) return fail(isCli, 'Task ID required: chemx team task show <id>', { error: 'taskId required' });
  const task = getTask(ctx.db, taskId);
  if (!task) return fail(isCli, `Task #${taskId} not found`);
  const events = queryFeed(ctx.db, { task_id: taskId });
  const dependencyStates = resolveDependencyStates(ctx.db, task);
  const links = duplicateLinks(ctx.db, taskId);
  const output = { task, dependencyStates, events, activityCount: events.length, ...links };
  if (!isCli) return flags.isJson ? output : { task, dependencyStates, events, ...links };
  process.stdout.write(flags.isJson ? `${JSON.stringify(output, null, 2)}\n` : formatTaskDetailCard(task, events, dependencyStates, buildLabelFor(task, loadModelRouting(ctx.root))) + formatDuplicateLinks(links));
  return flags.isJson ? output : { task, dependencyStates, events };
};

const runComment = (ctx, positionals, flags, isCli) => {
  const taskId = positionals[1];
  if (!taskId) return fail(isCli, 'Task ID required: chemx team task comment <id> <message>', { error: 'taskId required' });
  const msg = positionals.slice(2).join(' ') || flags.message;
  if (!msg) return fail(isCli, 'Message required', { error: 'message required' });
  const authorHandle = flags.as || '@agent';
  registerAgent(ctx.db, { id: authorHandle, role: 'contributor' });
  const ev = postFeedEvent(ctx.db, { author_id: authorHandle, task_id: Number(taskId), event_type: flags.type || 'status_update', message: msg });
  return writeJsonOr(ev, flags, isCli, `\x1b[32m✔\x1b[0m Posted update to task #${taskId}: ${msg}\n`);
};

const runClaim = (ctx, taskId, flags, isCli) => {
  const agentHandle = resolveCliAgent(flags, isCli);
  registerAgent(ctx.db, { id: agentHandle, role: 'executor' });
  const res = claimTask(ctx.db, taskId, agentHandle);
  if (!isCli) return res;
  const didClaim = Boolean(res.success);
  if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  else if (didClaim) process.stdout.write(`\x1b[32m✔\x1b[0m Claimed task #${taskId}\n`);
  else process.stderr.write(`\x1b[31m✕ Claim failed: ${res.message || res.reason}\x1b[0m\n`);
  return res;
};

// A --target on done/set-target is re-based to its owning repo like `task add --target`.
const retarget = (ctx, taskId, target, cwd) => {
  const prepared = prepareTaskTarget(ctx, cwd, target);
  const isRefused = Boolean(prepared.error);
  if (isRefused) return prepared;
  ctx.db.prepare('UPDATE agent_tasks SET target_path = ?, repo = ?, updated_at = ? WHERE id = ?').run(prepared.target_path, prepared.repo, Date.now(), Number(taskId));
  return prepared;
};

// Verification audits the target from its own repo, against that repo's code index.
const completionOptions = (ctx, task, flags) => {
  const taskDir = repoDir(ctx.root, task?.repo);
  const indexDb = openIndexDb(taskDir);
  return { ...buildCompletionOptions({ ...flags, target: undefined }, taskDir), indexDb: indexDb || ctx.db };
};

const runComplete = (ctx, taskId, flags, isCli, cwd, lead) => {
  const agentHandle = resolveCliAgent(flags, isCli);
  registerAgent(ctx.db, { id: agentHandle, role: 'executor' });
  const hasTargetOverride = Boolean(flags.target);
  const override = hasTargetOverride ? retarget(ctx, taskId, flags.target, cwd) : null;
  const isRefused = Boolean(override?.error);
  if (isRefused) return fail(isCli, override.error, { refused: true, error: override.error });
  const res = completeTaskWithAudit(ctx.db, taskId, agentHandle, completionOptions(ctx, getTask(ctx.db, taskId), flags));
  writeTaskResult(res, flags, isCli, () => describeCompletion(res, taskId, lead));
  return res;
};

const hasDependencyEdit = (flags) => Boolean(flags.dependencyTokens || flags.addDependencyTokens || flags.removeDependencyTokens);

const parseIdTokens = (tokens) => {
  const bad = tokens.filter((token) => !/^\d+$/.test(token));
  return { bad, ids: tokens.filter((token) => /^\d+$/.test(token)).map(Number) };
};

// True when `target` is reachable from any of `startIds` by following dependencies.
const reachesTask = (db, startIds, target) => {
  const seen = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.pop();
    const isTarget = id === target;
    if (isTarget) return true;
    const isNew = !seen.has(id);
    seen.add(id);
    if (isNew) queue.push(...(getTask(db, id)?.dependencies || []).map(Number));
  }
  return false;
};

// `task update <id> --deps=1,2` replaces the hard prerequisites (--deps= with no ids clears them);
// --add-dep=/--rm-dep= edit the current list. Applied in that order.
// Guaranteed: every id is an integer, exists, is not the task itself, and adding it creates no cycle
// in the dependencies stored at that moment. Not guaranteed: races with a concurrent edit.
// Returns { refused } without writing anything when a check fails.
const runSetDependencies = (ctx, taskId, flags, isCli) => {
  const self = Number(taskId);
  const parsed = [flags.dependencyTokens, flags.addDependencyTokens, flags.removeDependencyTokens].map((tokens) => parseIdTokens(tokens || []));
  const bad = parsed.flatMap((entry) => entry.bad);
  const hasBad = bad.length > 0;
  if (hasBad) return fail(isCli, `Dependencies refused: not a task id: ${bad.join(', ')}`, { error: 'invalid dependencies', refused: true });
  const [set, added, removed] = parsed.map((entry) => entry.ids);
  const base = flags.dependencyTokens ? set : (getTask(ctx.db, taskId)?.dependencies || []).map(Number);
  const ids = [...new Set([...base, ...added])].filter((id) => !removed.includes(id));
  const unknown = ids.filter((id) => id === self || !getTask(ctx.db, id));
  const hasUnknown = unknown.length > 0;
  if (hasUnknown) return fail(isCli, `Dependencies refused: #${unknown.join(', #')} is this task or does not exist`, { error: 'invalid dependencies', refused: true });
  const cyclic = ids.filter((id) => reachesTask(ctx.db, [id], self));
  const hasCycle = cyclic.length > 0;
  if (hasCycle) return fail(isCli, `Dependencies refused: #${cyclic.join(', #')} already depends on #${taskId}, which would form a cycle`, { error: 'dependency cycle', refused: true });
  ctx.db.prepare('UPDATE agent_tasks SET dependencies = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(ids), Date.now(), self);
  const agentHandle = resolveCliAgent(flags, isCli);
  registerAgent(ctx.db, { id: agentHandle, role: 'executor' });
  postFeedEvent(ctx.db, { author_id: agentHandle, task_id: Number(taskId), event_type: 'task_status_updated', message: `Set task #${taskId} dependencies to [${ids.join(', ')}]` });
  const label = ids.length ? `#${ids.join(', #')}` : 'none';
  return writeJsonOr(getTask(ctx.db, taskId), flags, isCli, `\x1b[32m✔\x1b[0m Task #${taskId} dependencies: ${label}\n`);
};

const runUpdate = (ctx, positionals, flags, isCli, cwd) => {
  const taskId = positionals[1];
  const isDepsEdit = hasDependencyEdit(flags);
  const depsResult = isDepsEdit ? runSetDependencies(ctx, taskId, flags, isCli) : null;
  const isDepsRefused = Boolean(depsResult?.refused);
  if (isDepsRefused) return depsResult;
  const isDepsOnly = isDepsEdit && !flags.status && !positionals[2];
  if (isDepsOnly) return depsResult;
  const targetStatus = flags.status || positionals[2] || 'in_progress';
  const isCompletion = targetStatus === 'done' || targetStatus === 'completed';
  if (isCompletion) return runComplete(ctx, taskId, flags, isCli, cwd, `Updated task #${taskId} to status "done"`);
  const agentHandle = resolveCliAgent(flags, isCli);
  registerAgent(ctx.db, { id: agentHandle, role: 'executor' });
  const res = updateTaskStatus(ctx.db, taskId, targetStatus, { blockedReason: flags.reason || '' });
  if (res) postFeedEvent(ctx.db, { author_id: agentHandle, task_id: Number(taskId), event_type: 'task_status_updated', message: `Updated task #${taskId} status to ${targetStatus}` });
  writeTaskResult(res, flags, isCli, () => describeStatusUpdate(res, taskId));
  return res;
};

const runCreate = (ctx, positionals, flags, titleWords, isCli, cwd) => {
  const createNeeds = checkNeedsInput(flags.needs);
  const hasCreateNeedsError = Boolean(createNeeds.error);
  if (hasCreateNeedsError) return fail(isCli, createNeeds.error);
  const placed = prepareTaskTarget(ctx, cwd, flags.target);
  const isRefused = Boolean(placed.error);
  if (isRefused) return fail(isCli, placed.error, { error: placed.error, refused: true });
  const title = flags.title || [...positionals.slice(1), ...titleWords].join(' ') || 'Untitled Task';
  const authorHandle = flags.as || '@agent';
  registerAgent(ctx.db, { id: authorHandle, role: 'contributor' });
  const hasAssignee = Boolean(flags.agent);
  if (hasAssignee) registerAgent(ctx.db, { id: flags.agent, role: 'executor' });
  const task = createTask(ctx.db, {
    title, description: flags.description || '', tier: resolveTaskTier(flags.tier, placed.target_path),
    target_path: placed.target_path, repo: placed.repo, priority: flags.priority || 2,
    assigned_agent_id: flags.agent || null, parent_id: flags.parent ?? null, dependencies: flags.dependencies || [],
    sprint_tag: flags.sprint || '', moscow: flags.moscow, needs: createNeeds.needs, rule_id: flags.rule || ''
  });
  if (task) postFeedEvent(ctx.db, { author_id: authorHandle, task_id: task.id, event_type: 'task_created', message: `Created task #${task.id}: ${task.title}` });
  return writeJsonOr(task, flags, isCli, `\x1b[32m✔\x1b[0m Created task #${task.id}: ${task.title} (repo ${task.repo})\n`);
};

const runReconcile = (ctx, flags, isCli, cwd) => {
  const resolved = reconcileAuditTasks(ctx.db, { cwd, repo: ctx.repo, root: ctx.root });
  const hasResolved = resolved.length > 0;
  const line = hasResolved ? `\x1b[32m✔\x1b[0m Reconciled and auto-resolved ${resolved.length} task(s) whose hazards were fixed.\n` : '\x1b[34mℹ\x1b[0m 0 tasks needed reconciliation.\n';
  return writeJsonOr(resolved, flags, isCli, line);
};

const runSetTarget = (ctx, positionals, flags, isCli, cwd) => {
  const taskId = positionals[1];
  const targetPath = flags.target || positionals[2];
  const canSet = Boolean(taskId) && Boolean(targetPath);
  if (!canSet) return fail(isCli, 'Usage: chemx team task set-target <taskId> <path>');
  const placed = retarget(ctx, taskId, targetPath, cwd);
  const isRefused = Boolean(placed.error);
  if (isRefused) return fail(isCli, placed.error, { error: placed.error, refused: true });
  const updated = getTask(ctx.db, taskId);
  return writeJsonOr(updated, flags, isCli, `\x1b[32m✔\x1b[0m Updated task #${taskId} target to ${placed.target_path} (repo ${placed.repo})\n`);
};

const ACTIONS = {
  list: (ctx, p, flags, words, isCli) => runList(ctx, flags, isCli),
  show: (ctx, p, flags, words, isCli) => runShow(ctx, p[1], flags, isCli),
  comment: (ctx, p, flags, words, isCli) => runComment(ctx, p, flags, isCli),
  'vds-slot': (ctx, p, flags, words, isCli) => handleTaskSlotCommand(ctx.db, p[1], p[2] || flags.moscow || 'must', p[3] || flags.priority || 'critical', isCli, flags.isJson),
  trace: (ctx, p, flags, words, isCli) => handleTaskTraceCommand(ctx.db, p[1], p[2] || flags.url, isCli, flags.isJson),
  claim: (ctx, p, flags, words, isCli) => runClaim(ctx, p[1], flags, isCli),
  handoff: (ctx, p, flags, words, isCli) => handleTaskHandoffCommand(ctx.db, p, flags, isCli),
  close: (ctx, p, flags, words, isCli) => handleTaskCloseCommand(ctx.db, p, flags, isCli),
  done: (ctx, p, flags, words, isCli, cwd) => runComplete(ctx, p[1], flags, isCli, cwd, `Completed task #${p[1]}`),
  update: (ctx, p, flags, words, isCli, cwd) => runUpdate(ctx, p, flags, isCli, cwd),
  add: (ctx, p, flags, words, isCli, cwd) => runCreate(ctx, p, flags, words, isCli, cwd),
  triage: (ctx, p, flags, words, isCli, cwd) => runTriage(ctx, flags, isCli, cwd),
  reconcile: (ctx, p, flags, words, isCli, cwd) => runReconcile(ctx, flags, isCli, cwd),
  'set-target': (ctx, p, flags, words, isCli, cwd) => runSetTarget(ctx, p, flags, isCli, cwd)
};

const ACTION_ALIASES = { view: 'show', info: 'show', post: 'comment', slot: 'vds-slot', complete: 'done', create: 'add', new: 'add', prune: 'reconcile', target: 'set-target' };

const canonicalAction = (action) => {
  const name = Object.hasOwn(ACTION_ALIASES, action) ? ACTION_ALIASES[action] : action;
  return Object.hasOwn(ACTIONS, name) ? name : null;
};

export const runTaskCommand = (ctx, positionals, flags, titleWords, isCli, cwd) => {
  // Only the action slot can ask for help; a task titled "... startup and help" must still be created.
  const isTaskHelp = flags.help || positionals[0] === 'help';
  if (isTaskHelp) {
    if (isCli) process.stdout.write(formatTaskHelpCard());
    return { help: true, actions: TASK_ACTIONS };
  }
  const taskAction = positionals[0] || 'list';
  const unknownTask = refuseUnknownTask(ctx.db, taskAction, positionals[1], { isCli, cwd });
  if (unknownTask) return unknownTask;
  const action = canonicalAction(taskAction);
  const isKnown = action !== null;
  if (isKnown) return ACTIONS[action](ctx, positionals, flags, titleWords, isCli, cwd);
  return fail(isCli, `Unknown task action: "${taskAction}". Available actions: list, show, view, add, claim, done, update, comment, triage, reconcile, set-target`, { error: `Unknown task action: ${taskAction}` });
};
