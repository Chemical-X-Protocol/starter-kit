/**
 * Tasks: `task handoff` is the sanctioned way to move a task between agents (#2548).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { claimTask, getTask } from './team-db-tasks.js';
import { requestFileLock, listActiveLeases } from './team-db-locks.js';
import { queryFeed } from './team-db-feed.js';
import { completeTaskWithAudit } from './team-triage.js';
import { runTeamCli } from './team-commands.js';
import { formatTaskHelpCard } from './team-format.js';

delete process.env.CHEMX_PROJECT_ROOT;

const DONE_OPTIONS = { noTargetConfirm: true, tokens: { prompt: 1000, completion: 1000 } };

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openIndexDb(root, { fresh: true });
  const task = runTeamCli(['task', 'add', 'handoff subject', '--as=@orch'], false, root);
  claimTask(db, task.id, '@alice');
  return { root, db, id: task.id };
};

const handoff = (root, id, to, by) => runTeamCli(['task', 'handoff', String(id), to, `--as=${by}`], false, root);

test('handoff: the assignee hands the task to another agent', (t) => {
  const { root, db, id } = makeBoard(t);
  const res = handoff(root, id, '@bob', '@alice');
  assert.equal(res.success, true);
  const task = getTask(db, id);
  assert.equal(task.assigned_agent_id, '@bob');
  assert.equal(task.status, 'in_progress');
});

test('handoff: the task creator can hand off a task it does not hold', (t) => {
  const { root, db, id } = makeBoard(t);
  const res = handoff(root, id, 'bob', '@orch');
  assert.equal(res.success, true);
  assert.equal(getTask(db, id).assigned_agent_id, '@bob');
});

test('handoff: a queued task becomes in_progress for the new assignee', (t) => {
  const { root, db } = makeBoard(t);
  const queued = runTeamCli(['task', 'add', 'still queued', '--as=@orch'], false, root);
  const res = handoff(root, queued.id, '@bob', '@orch');
  assert.equal(res.success, true);
  assert.equal(getTask(db, queued.id).status, 'in_progress');
});

test('handoff: a stranger is refused and nothing changes', (t) => {
  const { root, db, id } = makeBoard(t);
  const res = handoff(root, id, '@mallory', '@mallory');
  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_authorized');
  assert.match(res.message, /@alice/);
  assert.equal(getTask(db, id).assigned_agent_id, '@alice');
});

test('handoff: after it, the new assignee completes the task and the old one cannot', (t) => {
  const { root, db, id } = makeBoard(t);
  handoff(root, id, '@bob', '@alice');
  const refused = completeTaskWithAudit(db, id, '@alice', { cwd: root, ...DONE_OPTIONS });
  assert.equal(refused.reason, 'not_assignee');
  assert.match(refused.message, /chemx team task handoff/);
  assert.doesNotMatch(refused.message, /--force/);
  const done = completeTaskWithAudit(db, id, '@bob', { cwd: root, ...DONE_OPTIONS });
  assert.equal(done.status, 'done');
});

test('handoff: the activity event names from, to and by', (t) => {
  const { root, db, id } = makeBoard(t);
  handoff(root, id, '@bob', '@orch');
  const event = queryFeed(db, { task_id: id, event_type: 'task_handoff' })[0];
  assert.deepEqual(event.metadata, { from: '@alice', to: '@bob', by: '@orch' });
  assert.match(event.message, /@alice -> @bob \(by @orch\)/);
});

test('handoff: --as is required', (t) => {
  const { root, id } = makeBoard(t);
  const saved = ['CHEMX_AGENT_ID', 'CHEMX_SESSION_ID', 'CLAUDE_SESSION_ID'].map((name) => [name, process.env[name]]);
  saved.forEach(([name]) => delete process.env[name]);
  const restore = ([name, value]) => Object.assign(process.env, value === undefined ? {} : { [name]: value });
  t.after(() => saved.forEach(restore));
  const res = runTeamCli(['task', 'handoff', String(id), '@bob'], false, root);
  assert.equal(res.success, false);
  assert.equal(res.reason, 'as_required');
});

test('handoff: a refused claim names the handoff path', (t) => {
  const { db, id } = makeBoard(t);
  const res = claimTask(db, id, '@bob');
  assert.equal(res.reason, 'already_claimed');
  assert.match(res.message, new RegExp(`chemx team task handoff ${id} @bob --as=<them>`));
  assert.match(res.message, /@alice or the task creator/);
});

const leaseOwners = (db) => Object.fromEntries(listActiveLeases(db).map((lease) => [lease.file_path, lease.locked_by]));

test('handoff --with-locks: moves live leases naming the task, not other tasks or expired ones (#5740)', (t) => {
  const { root, db, id } = makeBoard(t);
  requestFileLock(db, 'cli/a.js', '@alice', { purpose: `#${id}` });
  requestFileLock(db, 'cli/other.js', '@alice', { purpose: `#${id}9` });
  requestFileLock(db, 'cli/old.js', '@alice', { purpose: `#${id}`, ttlMs: 1 });
  const res = runTeamCli(['task', 'handoff', String(id), '@bob', '--as=@alice', '--with-locks'], false, root);
  assert.equal(res.success, true);
  assert.deepEqual(res.movedLeases.map((lease) => lease.file_path), ['cli/a.js']);
  const owners = leaseOwners(db);
  assert.equal(owners['cli/a.js'], '@bob');
  assert.equal(owners['cli/other.js'], '@alice');
  const event = queryFeed(db, { task_id: id, event_type: 'lock_transferred' })[0];
  assert.deepEqual(event.metadata, { from: '@alice', to: '@bob', by: '@alice' });
});

test('handoff without --with-locks leaves every lease with the old holder (#5740)', (t) => {
  const { root, db, id } = makeBoard(t);
  requestFileLock(db, 'cli/a.js', '@alice', { purpose: `#${id}` });
  handoff(root, id, '@bob', '@alice');
  assert.equal(leaseOwners(db)['cli/a.js'], '@alice');
  assert.equal(queryFeed(db, { task_id: id, event_type: 'lock_transferred' }).length, 0);
});

test('handoff: the task help card lists it', () => {
  assert.match(formatTaskHelpCard(), /handoff.*<taskId> <@to>/);
});
