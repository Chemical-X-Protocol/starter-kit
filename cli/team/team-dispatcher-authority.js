/**
 * Chemical X Protocol: dispatcher authority (#4567).
 * The handle recorded as a dispatch run's dispatcher may hand off or close a task of that run
 * whose assignee is one of the run's handles (or a role handle under it, e.g. <handle>-repair).
 * Not guaranteed: it covers only recorded runs, only the recorded dispatcher, and only tasks
 * that are currently assigned to a run handle. Everyone else keeps assignee-or-creator authority.
 */

import { getRun } from './team-dispatch-runs.js';

const isRunHandle = (assignee, handle) => Boolean(handle) && (assignee === handle || assignee.startsWith(`${handle}-`));

/** The name of the run that lets `by` act as dispatcher for this task, or null. */
export const findDispatcherRun = (db, task, by) => {
  const assignee = task?.assigned_agent_id || '';
  const canLookUp = Boolean(db) && Boolean(task) && Boolean(assignee) && Boolean(by);
  if (!canLookUp) return null;
  let names = [];
  try {
    names = db.prepare('SELECT run_name FROM dispatch_run_tasks WHERE task_id = ?').all(Number(task.id)).map((row) => row.run_name);
  } catch {
    return null;
  }
  const match = names.map((name) => getRun(db, name)).find((run) => run && run.dispatcher === by && run.tasks.some((link) => link.task_id === Number(task.id) && isRunHandle(assignee, link.handle)));
  return match ? match.name : null;
};