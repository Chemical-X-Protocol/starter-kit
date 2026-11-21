import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { contextTaskId } from './context-task.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };

const addTask = (db, id, { status = 'queued', agent = null, claimedAt = null } = {}) => {
  db.prepare('INSERT INTO agent_tasks (id, title, status, assigned_agent_id, claimed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, `task ${id}`, status, agent, claimedAt, Date.now(), Date.now());
};

test('context task: a purpose naming an existing task wins over the claim', () => {
  const db = freshDb();
  addTask(db, 12);
  addTask(db, 20, { status: 'in_progress', agent: '@me', claimedAt: 5 });
  assert.equal(contextTaskId(db, { purpose: '#12', handle: '@me' }), 12);
});

test('context task: a purpose naming a missing task falls back to the claim', () => {
  const db = freshDb();
  addTask(db, 20, { status: 'in_progress', agent: '@me', claimedAt: 5 });
  addTask(db, 21, { status: 'in_progress', agent: '@me', claimedAt: 9 });
  assert.equal(contextTaskId(db, { purpose: '#999', handle: '@me' }), 21, 'newest claim');
});

test('context task: no claim and no purpose gives null', () => {
  const db = freshDb();
  addTask(db, 20, { status: 'done', agent: '@me', claimedAt: 5 });
  assert.equal(contextTaskId(db, { handle: '@me' }), null);
});

test('context task: a handle with or without @ resolves the same', () => {
  const db = freshDb();
  addTask(db, 20, { status: 'in_progress', agent: '@me', claimedAt: 5 });
  assert.equal(contextTaskId(db, { handle: '@me' }), 20);
  assert.equal(contextTaskId(db, { handle: 'me' }), 20);
});
