/**
 * Chemical X Protocol: Autonomous Project Coordinator Loop
 * Sense -> Decompose -> Delegate -> Verify -> Learn
 */

import { getActiveProjectSession, getProjectSession, updateProjectSession, postProjectMessage } from './team-projects.js';
import { queryRelevantLearnings } from './team-projects-memory.js';
import { listTasks, claimTask, createTask } from './team-db-tasks.js';
import { autoGenerateTasksFromAudit } from './team-triage.js';
import { sendDirectMessage } from './team-db-mailbox.js';
import { resolveAgentId } from './agent-identity.js';

// Claims the first queued task that accepts this agent. A refused claim (deps unmet, already
// held) leaves the task untouched; nothing is forced into in_progress without an assignee.
const claimFirstAvailable = (db, queuedTasks, agentId) => {
  const refusals = [];
  for (const candidate of queuedTasks) {
    const claim = claimTask(db, candidate.id, agentId);
    const isClaimed = claim?.success === true;
    if (isClaimed) return { task: claim.task, refusals };
    refusals.push({ id: candidate.id, reason: claim?.reason || 'refused' });
  }
  return { task: null, refusals };
};

export const executeCoordinatorStep = (db, options = {}) => {
  if (!db) return { status: 'error', message: 'Database unavailable' };
  const session = getActiveProjectSession(db);
  if (!session) return { status: 'no_active_session', message: 'No active project session. Run "chemx project init <goal>" first.' };

  const isBudgetExceeded = session.budget_spent_usd >= session.budget_limit_usd;
  if (isBudgetExceeded) {
    updateProjectSession(db, session.id, { status: 'paused_budget_exceeded' });
    postProjectMessage(db, { projectId: session.id, turnIndex: session.current_turn, authorId: '@coordinator', role: 'assistant', message: `Budget limit of $${session.budget_limit_usd.toFixed(2)} USD reached. Execution paused.` });
    return { status: 'paused_budget_exceeded', session: getProjectSession(db, session.id) };
  }

  const isTurnsExceeded = session.current_turn >= session.max_turns;
  if (isTurnsExceeded) {
    updateProjectSession(db, session.id, { status: 'paused_turns_exceeded' });
    postProjectMessage(db, { projectId: session.id, turnIndex: session.current_turn, authorId: '@coordinator', role: 'assistant', message: `Turn limit of ${session.max_turns} turns reached. Execution paused.` });
    return { status: 'paused_turns_exceeded', session: getProjectSession(db, session.id) };
  }

  const nextTurn = session.current_turn + 1;
  const turnCost = options.costUsd || 0.002;
  const newSpent = session.budget_spent_usd + turnCost;

  const activeTasks = listTasks(db, { status: 'in_progress' });
  let queuedTasks = listTasks(db, { status: 'queued' });

  const isBacklogEmpty = activeTasks.length === 0 && queuedTasks.length === 0;
  if (isBacklogEmpty) {
    const generated = autoGenerateTasksFromAudit(db, { cwd: options.cwd || process.cwd() });
    const isNothingGenerated = generated.length === 0;
    if (isNothingGenerated) {
      const defaultTask = createTask(db, {
        title: `Execute goal: ${session.goal_description}`,
        tier: 'general',
        priority: 1
      });
      if (defaultTask) queuedTasks = [defaultTask];
    } else {
      queuedTasks = listTasks(db, { status: 'queued' });
    }
  }

  let actionTaken = 'inspected';
  let taskDetail = null;
  let refusals = [];

  // The step acts for the caller (explicit handle, then CHEMX_AGENT_ID, then a per-process id),
  // never for a hardcoded persona that nobody is running.
  const agent = resolveAgentId(options.agentId || options.as);
  const hasQueued = queuedTasks.length > 0;
  const hasActive = activeTasks.length > 0;

  if (hasQueued) {
    const claimed = claimFirstAvailable(db, queuedTasks, agent);
    refusals = claimed.refusals;
    const target = claimed.task;
    const hasTarget = Boolean(target);
    if (hasTarget) {
      const learnings = queryRelevantLearnings(db, { tier: target.tier, limit: 2 });
      sendDirectMessage(db, {
        author_id: '@coordinator',
        recipient_id: agent,
        task_id: target.id,
        message: `Assigned task #${target.id}: "${target.title}". Applicable heuristics: ${learnings.length}`
      });
      actionTaken = `delegated_task_${target.id}_to_${agent}`;
      taskDetail = target;
    } else {
      actionTaken = 'no_claimable_task';
    }
  } else if (hasActive) {
    // In-progress work is only verified by its owner (task update review/done); the
    // coordinator reports it and waits instead of completing it unchecked.
    actionTaken = `awaiting_${activeTasks.length}_active_task(s)`;
  }

  updateProjectSession(db, session.id, { current_turn: nextTurn, budget_spent_usd: newSpent });
  postProjectMessage(db, {
    projectId: session.id,
    turnIndex: nextTurn,
    authorId: '@coordinator',
    role: 'assistant',
    message: `Turn ${nextTurn}/${session.max_turns}: ${actionTaken}. Cost: $${turnCost.toFixed(4)}`
  });

  return {
    status: 'ok',
    turn: nextTurn,
    action: actionTaken,
    agent,
    task: taskDetail,
    refusals,
    session: getProjectSession(db, session.id)
  };
};
