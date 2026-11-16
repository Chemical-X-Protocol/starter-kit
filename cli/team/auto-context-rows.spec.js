/**
 * The auto context rows (#7698): a comment, a commit and a done each write an agent_feed row that
 * carries the task_id, and the standup update check sees the comment row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';
import { runTaskCommand } from './team-commands-task.js';
import { recordCommit } from '../commit/commit-record.js';
import { initStandupSchema, runStandup } from './team-standup.js';

const FILES_SQL = 'CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT \'\', lines INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);';
const VIOLATIONS_SQL = 'CREATE TABLE violations (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, pillar TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, hazard TEXT NOT NULL, directive TEXT NOT NULL);';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(FILES_SQL);
  db.exec(VIOLATIONS_SQL);
  initTeamSchema(db);
  initStandupSchema(db);
  return db;
};

const feedRows = (db, taskId, type) => db.prepare('SELECT * FROM agent_feed WHERE task_id = ? AND event_type = ?').all(taskId, type);

const commentOn = (db, task) => runTaskCommand({ db }, ['comment', String(task.id), 'progress note'], { as: '@spec-a' }, [], false, process.cwd());

const claimedTask = (db) => {
  const task = createTask(db, { title: 'Auto rows', origin_type: 'manual' });
  claimTask(db, task.id, '@spec-a');
  return task;
};

test('a comment writes a feed row with the task id', () => {
  const db = setupDb();
  const task = claimedTask(db);
  commentOn(db, task);
  const rows = feedRows(db, task.id, 'status_update');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, task.id);
});

test('a commit writes a commit feed row with the task id', () => {
  const db = setupDb();
  const task = claimedTask(db);
  const wasRecorded = recordCommit(db, { committer: '@spec-a', taskId: task.id, sha: 'abc1234', subject: 'subject', files: ['a.js'] });
  assert.equal(wasRecorded, true);
  const rows = feedRows(db, task.id, 'commit');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, task.id);
});

test('done writes a task_complete feed row with the task id', () => {
  const db = setupDb();
  const task = claimedTask(db);
  const outcome = completeTaskWithAudit(db, task.id, '@spec-a', { noTargetConfirm: true });
  assert.notEqual(outcome?.refused, true, JSON.stringify(outcome));
  const rows = feedRows(db, task.id, 'task_complete');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, task.id);
});

const lightAt = (db, task, now) => runStandup(db, { now }).tasks.find((entry) => entry.id === task.id).newLight;

test('the standup update check sees the comment row', () => {
  const db = setupDb();
  const task = claimedTask(db);
  db.prepare('UPDATE agent_feed SET timestamp = 1000').run();
  lightAt(db, task, 5000);
  const quietLight = lightAt(db, task, 6000);
  assert.notEqual(quietLight, 'green', 'no feed row since the last standup');
  commentOn(db, task);
  const commentedLight = lightAt(db, task, Date.now() + 60000);
  assert.equal(commentedLight, 'green', 'the comment row counts as an update');
});
