import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { backupIndexDb, liveWork, planVdsMigration, statusPairs } from './team-vds-migrate.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vds-migrate-'));
const FIXED = new Date('2026-11-16T09:00:00Z');

test('team vds migrate: the backup is a dated copy and a second backup with the same time is refused', () => {
  const db = freshDb();
  createTask(db, { title: 'one' });
  const dir = scratch();
  const target = backupIndexDb(db, dir, FIXED);
  assert.ok(fs.existsSync(target), 'backup file written');
  assert.match(path.basename(target), /^index-2026-11-16T09-00-00-000Z\.db$/);
  assert.throws(() => backupIndexDb(db, dir, FIXED), /backup already exists/);
});

test('team vds migrate: live work refuses the plan unless forced, and planning never changes a row', () => {
  const db = freshDb();
  const busy = createTask(db, { title: 'busy' });
  createTask(db, { title: 'idle' });
  db.prepare("UPDATE agent_tasks SET status = 'in_progress' WHERE id = ?").run(busy.id);
  const before = JSON.stringify(db.prepare('SELECT id, status, vds_status FROM agent_tasks ORDER BY id').all());
  const plan = planVdsMigration(db, { backupDir: scratch(), now: FIXED });
  assert.equal(plan.refused, true);
  assert.deepEqual(plan.live.map((t) => t.id), [busy.id]);
  const forced = planVdsMigration(db, { backupDir: scratch(), now: new Date('2026-11-16T09:00:01Z'), force: true });
  assert.equal(forced.refused, false);
  const after = JSON.stringify(db.prepare('SELECT id, status, vds_status FROM agent_tasks ORDER BY id').all());
  assert.equal(after, before, 'planning changes no task rows');
});

test('team vds migrate: status pairs count each old status with its vds_status', () => {
  const db = freshDb();
  createTask(db, { title: 'a' });
  createTask(db, { title: 'b' });
  const pairs = statusPairs(db);
  assert.equal(pairs.reduce((sum, p) => sum + p.n, 0), 2);
  assert.equal(liveWork(db).length, 0);
});
