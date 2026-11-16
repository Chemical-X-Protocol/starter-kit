import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { recordVerify } from './verify-record.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };

const claim = (db, id, agent) => {
  db.prepare('INSERT INTO agent_tasks (id, title, status, assigned_agent_id, claimed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, `task ${id}`, 'in_progress', agent, 5, Date.now(), Date.now());
};

const verifyRows = (db) => db.prepare("SELECT * FROM agent_feed WHERE event_type = 'verify'").all();

test('record verify: a claimed handle gets one row with its task and status', async () => {
  const db = freshDb();
  claim(db, 30, '@me');
  await recordVerify(db, { handle: '@me', status: 'pass', scope: { dir: 'cli' } });
  const rows = verifyRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, 30);
  assert.equal(rows[0].message, 'verify PASS (cli)');
  assert.deepEqual(JSON.parse(rows[0].metadata), { status: 'pass', scope: { dir: 'cli' } });
});

test('record verify: a handle without a claim gets no row', async () => {
  const db = freshDb();
  claim(db, 30, '@other');
  await recordVerify(db, { handle: '@me', status: 'pass', scope: { dir: 'cli' } });
  assert.equal(verifyRows(db).length, 0);
});

test('record verify: a missing handle gets no row', async () => {
  const db = freshDb();
  claim(db, 30, '@me');
  await recordVerify(db, { status: 'fail', scope: { dir: 'cli' } });
  assert.equal(verifyRows(db).length, 0);
});
