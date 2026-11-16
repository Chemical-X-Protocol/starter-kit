import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { reparentTask } from './team-reparent.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };
const parentOf = (db, id) => db.prepare('SELECT parent_id FROM agent_tasks WHERE id = ?').get(id).parent_id;

test('team reparent: a task moves under another task and the parent is stored', () => {
  const db = freshDb();
  const boulder = createTask(db, { title: 'boulder' });
  const task = createTask(db, { title: 'task' });
  assert.deepEqual(reparentTask(db, task.id, boulder.id), { id: task.id, parentId: boulder.id });
  assert.equal(parentOf(db, task.id), boulder.id);
});

test('team reparent: a task cannot be its own parent', () => {
  const db = freshDb();
  const task = createTask(db, { title: 'task' });
  assert.match(reparentTask(db, task.id, task.id).error, /own parent/);
  assert.equal(parentOf(db, task.id), null);
});

test('team reparent: both tasks must exist', () => {
  const db = freshDb();
  const task = createTask(db, { title: 'task' });
  assert.match(reparentTask(db, 999, task.id).error, /Task #999 not found/);
  assert.match(reparentTask(db, task.id, 999).error, /Parent task #999 not found/);
});

test('team reparent: a parent below the task is refused as a cycle, at any depth', () => {
  const db = freshDb();
  const a = createTask(db, { title: 'a' });
  const b = createTask(db, { title: 'b' });
  const c = createTask(db, { title: 'c' });
  reparentTask(db, b.id, a.id);
  reparentTask(db, c.id, b.id);
  assert.match(reparentTask(db, a.id, c.id).error, /cycle/);
  assert.match(reparentTask(db, a.id, b.id).error, /cycle/);
  assert.equal(parentOf(db, a.id), null, 'a refused reparent writes nothing');
});
