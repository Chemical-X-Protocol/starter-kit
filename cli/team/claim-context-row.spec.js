import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { registerAgent } from './team-db-agents.js';
import { createTask } from './team-db-tasks.js';
import { claimWithIgnoreDeps } from './claim-ignore-deps.js';

const setup = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  registerAgent(db, { id: '@w1', role: 'coder' });
  const parent = createTask(db, { title: 'parent' });
  const child = createTask(db, { title: 'child', dependencies: [parent.id] });
  return { db, parent, child };
};

const rows = (db, taskId) => db.prepare("SELECT * FROM agent_feed WHERE task_id = ? AND event_type = 'task_claimed'").all(taskId);

test('a plain claim writes exactly one task_claimed row', () => {
  const { db, parent } = setup();
  const res = claimWithIgnoreDeps(db, parent.id, '@w1');
  assert.strictEqual(res.success, true);
  const found = rows(db, parent.id);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].task_id, parent.id);
  assert.strictEqual(found[0].author_id, '@w1');
});

test('an ignore-deps claim writes one row carrying the reason in metadata', () => {
  const { db, child } = setup();
  const res = claimWithIgnoreDeps(db, child.id, '@w1', 'landed first');
  assert.strictEqual(res.success, true);
  const all = db.prepare('SELECT * FROM agent_feed WHERE task_id = ?').all(child.id);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].event_type, 'task_claimed');
  assert.strictEqual(JSON.parse(all[0].metadata).ignoreDeps, 'landed first');
  assert.match(all[0].message, /landed first/);
});

test('a refused claim writes no row', () => {
  const { db, child } = setup();
  const res = claimWithIgnoreDeps(db, child.id, '@w1');
  assert.strictEqual(res.success, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM agent_feed WHERE task_id = ?').get(child.id).n, 0);
});
