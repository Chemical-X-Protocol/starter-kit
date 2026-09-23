/**
 * Chemical X Protocol: MCP Project & Coordinator Tools
 * Exposes persistent coordinator lifecycle, step execution, and memory via MCP
 */

import { openIndexDb } from '../search-db.js';
import {
  initProjectSession,
  getActiveProjectSession,
  postProjectMessage,
  getProjectMessages,
  updateProjectSession
} from '../team/team-projects.js';
import { queryRelevantLearnings } from '../team/team-projects-memory.js';
import { executeCoordinatorStep } from '../team/team-projects-coordinator.js';
import { listTasks } from '../team/team-db-tasks.js';

export const handleChemxProject = async (args = {}, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) {
    return { error: 'SQLite database unavailable' };
  }

  const subAction = args.subAction || args.action || 'status';

  const isInit = subAction === 'init' || subAction === 'start';
  if (isInit) {
    const goal = args.goal || args.title || 'Autonomous codebase optimization';
    return initProjectSession(db, {
      goal,
      title: (args.title || goal).slice(0, 40),
      budgetLimit: args.budgetLimit || 2.0,
      maxTurns: args.maxTurns || 10
    });
  }

  const isStep = subAction === 'step' || subAction === 'turn';
  if (isStep) {
    return executeCoordinatorStep(db, { cwd, costUsd: args.costUsd });
  }

  const isChat = subAction === 'chat' || subAction === 'msg';
  if (isChat) {
    const active = getActiveProjectSession(db);
    if (!active) return { error: 'no_active_session' };
    return postProjectMessage(db, {
      projectId: active.id,
      turnIndex: active.current_turn,
      authorId: args.as || '@user',
      role: 'user',
      message: args.message || 'Status check'
    });
  }

  const isLearnings = subAction === 'learnings' || subAction === 'memory';
  if (isLearnings) {
    return queryRelevantLearnings(db, { tier: args.tier, limit: args.limit || 10 });
  }

  const isPauseToggle = subAction === 'pause' || subAction === 'resume';
  if (isPauseToggle) {
    const active = getActiveProjectSession(db);
    if (!active) return { error: 'no_active_session' };
    const status = subAction === 'pause' ? 'paused' : 'active';
    return updateProjectSession(db, active.id, { status });
  }

  // Default: status
  const session = getActiveProjectSession(db);
  const messages = session ? getProjectMessages(db, session.id, 5) : [];
  const activeTasks = session ? listTasks(db, { status: 'in_progress' }) : [];
  const learnings = queryRelevantLearnings(db, { limit: 5 });

  return { session, messages, activeTasks, learnings };
};
