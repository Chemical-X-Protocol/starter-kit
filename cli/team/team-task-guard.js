/**
 * Task actions that change or annotate an existing task refuse an id this board does not hold.
 * Without it, `done` on a missing id printed "Completed" and `comment` posted a ghost event,
 * which is what happens when an agent in a git worktree talks to that checkout's own board.
 */
import { getTask } from './team-db.js';

const ID_ACTIONS = new Set(['done', 'complete', 'comment', 'post', 'update', 'claim', 'set-target']);

/**
 * @returns {null | { error: 'not_found', taskId: number, message: string }}
 */
export const refuseUnknownTask = (db, taskAction, taskId, { isCli = false, cwd = process.cwd() } = {}) => {
  const needsTask = ID_ACTIONS.has(taskAction) && Boolean(taskId);
  if (!needsTask) return null;
  const exists = Boolean(getTask(db, taskId));
  if (exists) return null;
  const message = `Task #${taskId} not found on the team board for ${cwd}. Nothing was changed. In a git worktree, run team commands from the main checkout.`;
  if (isCli) {
    process.stderr.write(`\x1b[31m✕ ${message}\x1b[0m\n`);
    process.exitCode = 1;
  }
  return { error: 'not_found', taskId: Number(taskId), message };
};
