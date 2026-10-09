/**
 * Review follow-ups on #1482: the ownership check is re-run inside the write
 * transaction (no TOCTOU against a concurrent reassignment), and a refused
 * `task done` exits non-zero so scripts can tell it from a completion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';

const CLI_PATH = fileURLToPath(new URL('../index.js', import.meta.url));
const TASK_SELECT = 'SELECT * FROM agent_tasks WHERE id = ?';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ownership-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ownership-race-fixture"}\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

// After the first task read, another agent takes the task over (a concurrent writer).
const reassignAfterFirstRead = (db, taskId, newOwner) => {
  let reads = 0;
  const wrapStatement = (stmt) => new Proxy(stmt, {
    get(target, prop) {
      if (prop !== 'get') return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
      return (...args) => {
        const row = target.get(...args);
        reads += 1;
        if (reads === 1) db.prepare('UPDATE agent_tasks SET assigned_agent_id = ? WHERE id = ?').run(newOwner, taskId);
        return row;
      };
    }
  });
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === 'prepare') return (sql) => (sql === TASK_SELECT ? wrapStatement(target.prepare(sql)) : target.prepare(sql));
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};

test('ownership: a reassignment between the snapshot and the write is caught in the transaction', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'raced' });
  claimTask(db, task.id, '@alice');

  const racedDb = reassignAfterFirstRead(db, task.id, '@bob');
  const res = completeTaskWithAudit(racedDb, task.id, '@alice', { cwd: root, noTargetConfirm: true });
  assert.equal(res?.refused, true, 'alice no longer owns the task when the write happens');
  assert.equal(res.reason, 'not_assignee');
  const after = getTask(db, task.id);
  assert.equal(after.status, 'in_progress');
  assert.equal(after.assigned_agent_id, '@bob');
});

test('cli: a refused task done exits non-zero; a completion exits zero', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'alice work' });
  claimTask(db, task.id, '@alice');
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.CHEMX_PROJECT_ROOT;
  const run = (as) => spawnSync(process.execPath, [CLI_PATH, 'team', 'task', 'done', String(task.id), `--as=${as}`, '--no-target-confirm'], { cwd: root, env, encoding: 'utf-8' });

  const refused = run('@mallory');
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /Refusing to complete task/);
  const done = run('@alice');
  assert.equal(done.status, 0, done.stderr);
});
