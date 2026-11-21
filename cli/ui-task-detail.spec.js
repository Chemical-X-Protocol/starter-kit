import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { getTaskDetail } from './ui-task-detail.js';
import { routeGet } from './ui-server-routes.js';

const add = (db, title, extra = {}) => {
  const row = { parent_id: null, dependencies: '[]', status: 'queued', ...extra };
  return Number(db.prepare('INSERT INTO agent_tasks (title, status, parent_id, dependencies, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
    .run(title, row.status, row.parent_id, row.dependencies).lastInsertRowid);
};

test('ui-task-detail: the row plus parent, children, dependencies and dependents', () => {
  const db = new DatabaseSync(':memory:'); initTeamSchema(db);
  const epic = add(db, 'epic');
  const dep = add(db, 'dep', { status: 'done' });
  const task = add(db, 'task', { parent_id: epic, dependencies: JSON.stringify([dep, 999]) });
  const child = add(db, 'child', { parent_id: task });
  const after = add(db, 'after', { dependencies: JSON.stringify([task]) });
  add(db, 'decoy', { dependencies: JSON.stringify([Number(`${task}1`)]) });
  const { success, task: row, related } = getTaskDetail(db, task);
  assert.equal(success, true);
  assert.equal(row.title, 'task');
  assert.equal(related.parent.id, epic);
  assert.deepEqual(related.children.map((t) => t.id), [child]);
  assert.deepEqual(related.dependencies.map((t) => [t.id, t.status]), [[dep, 'done']]);
  assert.deepEqual(related.dependents.map((t) => t.id), [after]);
  assert.deepEqual(routeGet(`/api/tasks/${task}`, db).related.dependents.map((t) => t.id), [after]);
  assert.equal(getTaskDetail(db, 4242).success, false);
});
