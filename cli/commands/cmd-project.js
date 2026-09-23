/**
 * cmd-project.js: Persistent Coordinator and Projects CLI Handler
 * Dispatches init, status, step, chat, pause, resume, and learnings
 */

import { openIndexDb } from '../search-db.js';
import {
  initProjectSession, getActiveProjectSession, getProjectSession,
  postProjectMessage, getProjectMessages, updateProjectSession
} from '../team/team-projects.js';
import { queryRelevantLearnings, formatLearningsCard } from '../team/team-projects-memory.js';
import { executeCoordinatorStep } from '../team/team-projects-coordinator.js';
import { formatProjectStatusCard } from '../team/team-projects-format.js';
import { listTasks } from '../team/team-db-tasks.js';

export const runProjectCli = async (rawArgs = [], isCli = false, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) {
    if (isCli) process.stderr.write('\x1b[31m✕ SQLite database unavailable.\x1b[0m\n');
    return null;
  }

  const isJson = rawArgs.includes('--json');
  const nonFlag = rawArgs.filter((a) => !a.startsWith('-'));
  const subCommand = nonFlag[0] || 'status';
  const restText = nonFlag.slice(1).join(' ');

  if (subCommand === 'init' || subCommand === 'start') {
    const goal = restText || 'Autonomous codebase optimization';
    const session = initProjectSession(db, { goal, title: goal.slice(0, 40) });
    if (isCli) {
      if (isJson) process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
      else process.stdout.write(`\x1b[32m✔\x1b[0m Initialized project session #${session.id}: "${session.title}"\n`);
    }
    return session;
  }

  if (subCommand === 'step' || subCommand === 'turn') {
    const res = executeCoordinatorStep(db, { cwd });
    if (isCli) {
      if (isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      else process.stdout.write(`\x1b[36m⚡ [Turn ${res.turn || 0}]\x1b[0m ${res.action || res.status} - Status: ${res.status}\n`);
    }
    return res;
  }

  if (subCommand === 'chat' || subCommand === 'msg') {
    const active = getActiveProjectSession(db);
    if (!active) {
      if (isCli) process.stderr.write('\x1b[31m✕ No active project. Run "chemx project init <goal>" first.\x1b[0m\n');
      return { error: 'no_active_session' };
    }
    const msg = postProjectMessage(db, {
      projectId: active.id,
      turnIndex: active.current_turn,
      authorId: '@user',
      role: 'user',
      message: restText || 'Status report'
    });
    if (isCli) {
      if (isJson) process.stdout.write(`${JSON.stringify(msg, null, 2)}\n`);
      else process.stdout.write(`\x1b[32m✔\x1b[0m Sent message to coordinator: "${msg.message}"\n`);
    }
    return msg;
  }

  if (subCommand === 'learnings' || subCommand === 'memory') {
    const learnings = queryRelevantLearnings(db, { limit: 10 });
    if (isCli) {
      if (isJson) process.stdout.write(`${JSON.stringify(learnings, null, 2)}\n`);
      else process.stdout.write(formatLearningsCard(learnings));
    }
    return learnings;
  }

  if (subCommand === 'pause' || subCommand === 'resume') {
    const active = getActiveProjectSession(db);
    if (!active) return null;
    const newStatus = subCommand === 'pause' ? 'paused' : 'active';
    const updated = updateProjectSession(db, active.id, { status: newStatus });
    if (isCli) process.stdout.write(`\x1b[32m✔\x1b[0m Project #${active.id} status updated to: ${newStatus}\n`);
    return updated;
  }

  // Default: status
  const session = getActiveProjectSession(db);
  const messages = session ? getProjectMessages(db, session.id, 5) : [];
  const activeTasks = session ? listTasks(db, { status: 'in_progress' }) : [];
  const learnings = queryRelevantLearnings(db, { limit: 5 });

  if (isJson) {
    const payload = { session, messages, activeTasks, learnings };
    if (isCli) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  const card = formatProjectStatusCard({ session, messages, activeTasks, learnings });
  if (isCli) process.stdout.write(card);
  return { session, messages, activeTasks, learnings };
};
