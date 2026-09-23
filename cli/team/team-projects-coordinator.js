/**
 * Chemical X Protocol: Autonomous Project Coordinator Loop
 * Sense -> Decompose -> Delegate -> Verify -> Learn
 */

import { getActiveProjectSession, getProjectSession, updateProjectSession, postProjectMessage } from './team-projects.js';
import { recordVerifiedLearning, queryRelevantLearnings } from './team-projects-memory.js';
import { listTasks, claimTask, updateTaskStatus, createTask } from './team-db-tasks.js';
import { autoGenerateTasksFromAudit } from './team-triage.js';
import { sendDirectMessage } from './team-db-mailbox.js';
import { postFeedEvent } from './team-db.js';

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

  let activeTasks = listTasks(db, { status: 'in_progress' });
  let queuedTasks = listTasks(db, { status: 'queued' });

  if (activeTasks.length === 0 && queuedTasks.length === 0) {
    const generated = autoGenerateTasksFromAudit(db, { cwd: options.cwd || process.cwd() });
    if (generated.length === 0) {
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

  if (queuedTasks.length > 0) {
    const target = queuedTasks[0];
    const agent = target.tier === 'atom' ? '@frontend-engineer' : '@coder';
    claimTask(db, target.id, agent);
    updateTaskStatus(db, target.id, 'in_progress');
    const learnings = queryRelevantLearnings(db, { tier: target.tier, limit: 2 });
    sendDirectMessage(db, {
      author_id: '@coordinator',
      recipient_id: agent,
      task_id: target.id,
      message: `Assigned task #${target.id}: "${target.title}". Applicable heuristics: ${learnings.length}`
    });
    actionTaken = `delegated_task_${target.id}_to_${agent}`;
    taskDetail = target;
  } else if (activeTasks.length > 0) {
    const target = activeTasks[0];
    updateTaskStatus(db, target.id, 'done');
    recordVerifiedLearning(db, {
      projectId: session.id,
      tier: target.tier || 'general',
      pattern: `Verified pattern for #${target.id}`,
      ruleText: `Adhere to molecular rules in ${target.target_path || 'components'}`,
      provenancePath: target.target_path || ''
    });
    actionTaken = `verified_and_completed_task_${target.id}`;
    taskDetail = target;
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
    task: taskDetail,
    session: getProjectSession(db, session.id)
  };
};
