import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db-tasks.js';
import { reconcileAuditTasks } from './team-triage.js';

process.env.CHEMX_TEST = '1';

const EM_DASH = String.fromCharCode(0x2014);

const withProject = (fn) => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-reconcile-')));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initTeamSchema(db);
  try {
    fn({ cwd, db });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

const statusOf = (db, id) => db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(id).status;

test('reconcileAuditTasks: a LOW-only rule task stays open while its own rule still fires', () => {
  withProject(({ cwd, db }) => {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src/f1.js'), `// note ${EM_DASH} here\nexport const a = 1;\n`);
    const task = createTask(db, { title: 'em dash', target_path: 'src/f1.js', origin_type: 'audit', rule_id: 'TYPOGRAPHY_EM_DASH' });

    const resolved = reconcileAuditTasks(db, { cwd });

    assert.strictEqual(resolved.some((r) => r.id === task.id), false);
    assert.strictEqual(statusOf(db, task.id), 'queued');
  });
});

test('reconcileAuditTasks: the task closes once its own rule no longer fires', () => {
  withProject(({ cwd, db }) => {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src/f1.js'), 'export const a = 1;\n');
    const task = createTask(db, { title: 'em dash', target_path: 'src/f1.js', origin_type: 'audit', rule_id: 'TYPOGRAPHY_EM_DASH' });

    reconcileAuditTasks(db, { cwd });

    assert.strictEqual(statusOf(db, task.id), 'done');
  });
});
