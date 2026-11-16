import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { initStandupSchema, lightsFor, nextStandup, recordLight } from './team-standup.js';

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
