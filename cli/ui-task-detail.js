/**
 * GET /api/tasks/<id>: the whole task row plus the tasks it links to (#7636), so the task sheet can show
 * everything the board knows: parent, subtasks, dependencies (ids in the row's JSON dependencies list) and
 * dependents (tasks that list this one). Linked tasks carry only id, title, status and assignee.
 */
import { getTask } from './team/team-db-tasks.js';

const LINK_COLUMNS = 'id, title, status, assigned_agent_id AS assignee';

const parseIds = (raw) => {
  let list = [];
  try { list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]'); } catch { list = []; } // chemx-allow: a malformed dependencies cell reads as no dependencies
  return (Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
};

const byIds = (db, ids) => {
  const hasIds = ids.length > 0;
  if (!hasIds) return [];
  const marks = ids.map(() => '?').join(',');
  return db.prepare(`SELECT ${LINK_COLUMNS} FROM agent_tasks WHERE id IN (${marks}) ORDER BY id`).all(...ids);
};

// Dependents: rows whose dependencies JSON names this id; the LIKE narrows, parseIds confirms (so 7 never matches 17).
const dependentsOf = (db, id) => db
  .prepare(`SELECT ${LINK_COLUMNS}, dependencies FROM agent_tasks WHERE dependencies LIKE ? ORDER BY id`)
  .all(`%${id}%`)
  .filter((row) => parseIds(row.dependencies).includes(id))
  .map(({ dependencies, ...link }) => link);

export const getTaskDetail = (db, taskId) => {
  const task = getTask(db, taskId);
  if (!task) return { success: false, error: 'Task not found' };
  const id = Number(task.id);
  const hasParent = Boolean(task.parent_id);
  const related = {
    parent: hasParent ? byIds(db, [Number(task.parent_id)])[0] || null : null,
    children: db.prepare(`SELECT ${LINK_COLUMNS} FROM agent_tasks WHERE parent_id = ? ORDER BY id`).all(id),
    dependencies: byIds(db, parseIds(task.dependencies)),
    dependents: dependentsOf(db, id)
  };
  return { success: true, task, related };
};
