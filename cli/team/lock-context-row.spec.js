import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { requestFileLock, releaseFileLock } from './team-db-locks.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };
const lastRow = (db, type) => db.prepare('SELECT * FROM agent_feed WHERE event_type = ? ORDER BY id DESC LIMIT 1').get(type);

test('lock context: an acquire with purpose #<id> carries that task_id', () => {
  const db = freshDb();
  const task = createTask(db, { title: 'named' });
  requestFileLock(db, 'a.js', '@alice', { purpose: `#${task.id}` });
  assert.equal(lastRow(db, 'lock_acquired').task_id, task.id);
});

test('lock context: a purpose-less acquire takes the in_progress claim, and the release carries it too', () => {
  const db = freshDb();
  const task = createTask(db, { title: 'claimed' });
  db.prepare("UPDATE agent_tasks SET status = 'in_progress', assigned_agent_id = '@alice', claimed_at = ? WHERE id = ?").run(Date.now(), task.id);
  requestFileLock(db, 'b.js', '@alice');
  assert.equal(lastRow(db, 'lock_acquired').task_id, task.id);
  releaseFileLock(db, 'b.js', '@alice');
  assert.equal(lastRow(db, 'lock_released').task_id, task.id);
});
