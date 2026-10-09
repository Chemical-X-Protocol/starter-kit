/**
 * Tasks: `task done` checks ownership (finding task-done-no-ownership-check).
 * Only the claiming agent completes a task; overrides are recorded; refused attempts add no telemetry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { completeTaskWithAudit } from './team-triage.js';
import { runTeamCli } from './team-commands.js';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-ownership-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const DONE_OPTIONS = { noTargetConfirm: true, tokens: { prompt: 1000, completion: 1000 } };

test('ownership: another agent cannot complete a claimed task', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'alice work' });
  claimTask(db, task.id, '@alice');

  const res = completeTaskWithAudit(db, task.id, '@mallory', { cwd: root, ...DONE_OPTIONS });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'not_assignee');
  assert.match(res.message, /assigned to @alice, not @mallory/);
  assert.equal(getTask(db, task.id).status, 'in_progress');
});

test('ownership: a queued, unclaimed task cannot be completed', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'nobody claimed this' });
  const res = completeTaskWithAudit(db, task.id, '@x', { cwd: root, ...DONE_OPTIONS });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'not_claimed');
  assert.match(res.message, /chemx team task claim/);
  assert.equal(getTask(db, task.id).status, 'queued');
});

test('ownership: the claiming agent completes its task', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'mine' });
  claimTask(db, task.id, '@alice');
  const done = completeTaskWithAudit(db, task.id, '@alice', { cwd: root, ...DONE_OPTIONS });
  assert.equal(done.status, 'done');
  assert.equal(done.result_payload.ownershipOverride, undefined);
});

test('ownership: --force overrides and the override is recorded in the receipt', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'stuck with bob' });
  claimTask(db, task.id, '@bob');
  const done = completeTaskWithAudit(db, task.id, '@lead', { cwd: root, force: true, ...DONE_OPTIONS });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.diff_receipt.ownershipOverride, {
    by: '@lead', via: 'force', reason: 'not_assignee', previousAssignee: '@bob', previousStatus: 'in_progress'
  });
});

test('ownership: refused attempts never add telemetry to the agent or task', (t) => {
  const { root, db } = makeProject(t);
  registerAgent(db, { id: '@carol', role: 'executor' });
  const task = createTask(db, { title: 'not carol' });
  for (let i = 0; i < 3; i++) completeTaskWithAudit(db, task.id, '@carol', { cwd: root, ...DONE_OPTIONS });
  assert.equal(db.prepare("SELECT total_tokens FROM agents WHERE id = '@carol'").get().total_tokens, 0);
  assert.equal(getTask(db, task.id).total_tokens, 0);
});

test('ownership: the CLI prints the ownership refusal', (t) => {
  const { root, db } = makeProject(t);
  const task = createTask(db, { title: 'cli check' });
  claimTask(db, task.id, '@alice');
  const res = runTeamCli(['task', 'done', String(task.id), '--as=@mallory', '--no-target-confirm'], false, root);
  assert.equal(res.refused, true);
  assert.equal(res.ownership, true);
});
