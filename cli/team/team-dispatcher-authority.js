/**
 * Chemical X Protocol: dispatcher and run authority (#4567, #5894).
 * The handle recorded as a dispatch run's dispatcher may hand off or close a task of that run
 * whose assignee is one of the run's handles (or a role handle under it, e.g. <handle>-repair).
 * The run's own handles have the same authority over that task, under their own identity: the
 * task's builder handle, its role handles (<handle>-review, <handle>-repair) and the run's gate
 * (@<run>-gate), so a repair takes the task over and the gate closes it without acting as the builder.
 * Not guaranteed: it covers only recorded runs and only tasks that are currently assigned to a run
 * handle. Everyone else keeps assignee-or-creator authority.
 */

import { getRun } from './team-dispatch-runs.js';

const isRunHandle = (assignee, handle) => Boolean(handle) && (assignee === handle || assignee.startsWith(`${handle}-`));

const roleOf = (run, link, by) => {
  const isDispatcher = run.dispatcher === by;
  if (isDispatcher) return 'dispatcher';
  const isPeer = isRunHandle(by, link.handle) || by === `@${run.name}-gate`;
  return isPeer ? 'run handle' : null;
};

/** The run that lets `by` act on this task and in which role ({ run, role }), or null. */
export const findRunAuthority = (db, task, by) => {
  const assignee = task?.assigned_agent_id || '';
  const canLookUp = Boolean(db) && Boolean(task) && Boolean(assignee) && Boolean(by);
  if (!canLookUp) return null;
  let names = [];
  try {
    names = db.prepare('SELECT run_name FROM dispatch_run_tasks WHERE task_id = ?').all(Number(task.id)).map((row) => row.run_name);
  } catch {
    return null;
  }
  for (const run of names.map((name) => getRun(db, name)).filter(Boolean)) {
    const link = run.tasks.find((entry) => entry.task_id === Number(task.id) && isRunHandle(assignee, entry.handle));
    const role = link ? roleOf(run, link, by) : null;
    if (role) return { run: run.name, role };
  }
  return null;
};

/** The name of the run that lets `by` act on this task (as its dispatcher or one of its handles), or null. */
export const findDispatcherRun = (db, task, by) => findRunAuthority(db, task, by)?.run ?? null;