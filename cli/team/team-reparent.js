/**
 * `chemx team task parent <taskId> <parentId>`: moves a task under another task (#7676).
 * Refuses a missing task, a task that is its own parent, and a parent that is the task itself or one of its
 * descendants, since that would make a cycle in the task tree.
 */

const parentIdOf = (db, taskId) => db.prepare('SELECT parent_id FROM agent_tasks WHERE id = ?').get(Number(taskId))?.parent_id ?? null;

const findTaskRow = (db, taskId) => db.prepare('SELECT id FROM agent_tasks WHERE id = ?').get(Number(taskId));

/** The task's ancestors, nearest first. The walk stops on a repeated id, so a malformed tree cannot loop forever. */
const ancestorsOf = (db, taskId) => {
  const chain = [];
  let current = parentIdOf(db, taskId);
  while (current !== null && !chain.includes(current)) {
    chain.push(current);
    current = parentIdOf(db, current);
  }
  return chain;
};

/**
 * Sets a task's parent. The new parent is the task itself or sits below it when the task appears among the
 * parent's own ancestors, which is the cycle this refuses.
 * @returns {{ id: number, parentId: number } | { error: string }}
 */
export const reparentTask = (db, taskId, parentId) => {
  const id = Number(taskId);
  const newParent = Number(parentId);
  const isTaskFound = Boolean(findTaskRow(db, id));
  if (!isTaskFound) return { error: `Task #${taskId} not found.` };
  const isParentFound = Boolean(findTaskRow(db, newParent));
  if (!isParentFound) return { error: `Parent task #${parentId} not found.` };
  const isSelfParent = id === newParent;
  if (isSelfParent) return { error: `Task #${id} cannot be its own parent.` };
  const isCycle = ancestorsOf(db, newParent).includes(id);
  if (isCycle) return { error: `Task #${newParent} is below task #${id} in the tree, so making it the parent would create a cycle.` };
  db.prepare('UPDATE agent_tasks SET parent_id = ? WHERE id = ?').run(newParent, id);
  return { id, parentId: newParent };
};
