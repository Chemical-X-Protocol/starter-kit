import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { initStandupSchema, lightsFor, nextStandup, recordLight, runStandup } from './team-standup.js';

const freshDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  initStandupSchema(db);
  return db;
};

test('team standup: the schema is additive and safe to run twice', () => {
  const db = freshDb();
  initStandupSchema(db);
  const columns = db.prepare('PRAGMA table_info(standup_lights)').all().map((col) => col.name);
  assert.deepEqual(columns, ['task_id', 'standup', 'light', 'set_by', 'at']);
});

test('team standup: only green, yellow, red and blocked are recorded', () => {
  const db = freshDb();
  for (const light of ['green', 'yellow', 'red', 'blocked']) {
    assert.equal(recordLight(db, { taskId: 1, standup: 1, light, setBy: '@a', now: 10 }).light, light);
  }
  assert.ok(recordLight(db, { taskId: 1, standup: 2, light: 'purple', setBy: '@a', now: 10 }).error, 'purple is refused');
  assert.ok(recordLight(db, { taskId: 1, standup: 2, setBy: '@a', now: 10 }).error, 'a missing light is refused');
  assert.equal(lightsFor(db, 1).length, 1, 'a refused light writes nothing');
});

test('team standup: a second light in the same standup replaces the first', () => {
  const db = freshDb();
  recordLight(db, { taskId: 7, standup: 1, light: 'green', setBy: '@a', now: 10 });
  recordLight(db, { taskId: 7, standup: 1, light: 'red', setBy: '@b', now: 20 });
  assert.deepEqual(lightsFor(db, 7), [{ task_id: 7, standup: 1, light: 'red', set_by: '@b', at: 20 }]);
});

test('team standup: lights for one task come back ordered by standup', () => {
  const db = freshDb();
  recordLight(db, { taskId: 7, standup: 3, light: 'red', setBy: '@a', now: 30 });
  recordLight(db, { taskId: 7, standup: 1, light: 'green', setBy: '@a', now: 10 });
  recordLight(db, { taskId: 8, standup: 2, light: 'yellow', setBy: '@a', now: 20 });
  assert.deepEqual(lightsFor(db, 7).map((row) => row.standup), [1, 3]);
  assert.deepEqual(lightsFor(db, 99), []);
});

test('team standup: the next standup is one past the highest, or 1 on an empty board', () => {
  const db = freshDb();
  assert.equal(nextStandup(db), 1);
  recordLight(db, { taskId: 1, standup: 4, light: 'green', setBy: '@a', now: 10 });
  recordLight(db, { taskId: 2, standup: 2, light: 'green', setBy: '@a', now: 10 });
  assert.equal(nextStandup(db), 5);
});

const addTask = (db, title, status = 'in_progress') =>
  Number(db.prepare('INSERT INTO agent_tasks (title, status, created_at, updated_at) VALUES (?, ?, 0, 0)').run(title, status).lastInsertRowid);

const addFeedEvent = (db, taskId, timestamp) =>
  db.prepare("INSERT INTO agent_feed (timestamp, author_id, task_id, event_type, message) VALUES (?, '@a', ?, 'comment', 'note')").run(timestamp, taskId);

test('team standup run: a task with no update moves green to yellow', () => {
  const db = freshDb();
  const id = addTask(db, 'quiet task');
  const { tasks } = runStandup(db, { setBy: '@a', now: 100 });
  assert.deepEqual(tasks, [{ id, title: 'quiet task', oldLight: 'green', newLight: 'yellow' }]);
  assert.equal(lightsFor(db, id).at(-1).light, 'yellow');
});

test('team standup run: an update since the previous standup sends the task back to green', () => {
  const db = freshDb();
  const id = addTask(db, 'busy task');
  runStandup(db, { now: 100 });
  addFeedEvent(db, id, 150);
  const { tasks } = runStandup(db, { now: 200 });
  assert.deepEqual(tasks.map((row) => [row.oldLight, row.newLight]), [['yellow', 'green']]);
});

test('team standup run: a blocked task stays blocked', () => {
  const db = freshDb();
  const id = addTask(db, 'stuck task');
  recordLight(db, { taskId: id, standup: 1, light: 'blocked', setBy: '@a', now: 10 });
  addFeedEvent(db, id, 50);
  const { standup, tasks } = runStandup(db, { now: 100 });
  assert.equal(standup, 2);
  assert.deepEqual(tasks.map((row) => [row.oldLight, row.newLight]), [['blocked', 'blocked']]);
});

test('team standup run: each run takes the next standup number and skips closed tasks', () => {
  const db = freshDb();
  addTask(db, 'open task', 'queued');
  addTask(db, 'finished task', 'done');
  assert.equal(runStandup(db, { now: 100 }).standup, 1);
  const second = runStandup(db, { now: 200 });
  assert.equal(second.standup, 2);
  assert.deepEqual(second.tasks.map((row) => row.title), ['open task']);
  assert.equal(nextStandup(db), 3);
});
