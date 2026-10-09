/**
 * Tasks: `task close` ends a duplicate or cancelled task without the done gate (#2575).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getTask } from './team-db-tasks.js';
import { queryFeed } from './team-db-feed.js';
import { selectDispatchTasks } from './team-dispatch.js';
import { runTeamCli } from './team-commands.js';
import { checkDependenciesMet } from './team-db-task-helpers.js';
import { duplicateLinks, formatDuplicateLinks } from './team-task-close.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = runTeamCli(['task', 'add', 'original bug', '--as=@orch'], false, root);
  const copy = runTeamCli(['task', 'add', 'same bug again', '--as=@orch'], false, root);
  return { root, original: original.id, copy: copy.id };
};

// Opened after the CLI calls so no second connection is open while the CLI stamps the db.
const readDb = (root) => openIndexDb(root);

const close = (root, id, flag, by) => runTeamCli(['task', 'close', String(id), flag, `--as=${by}`], false, root);

test('close: the creator closes a task as a duplicate and the link is recorded', (t) => {
  const { root, original, copy } = makeBoard(t);
  const res = close(root, copy, `--duplicate-of=${original}`, '@orch');
  assert.equal(res.success, true);
  const db = readDb(root);
  assert.equal(getTask(db, copy).status, 'duplicate');
  const event = queryFeed(db, { task_id: copy }).find((e) => e.event_type === 'task_closed');
  assert.equal(event.metadata.duplicate_of, original);
  assert.equal(formatDuplicateLinks(duplicateLinks(db, copy)), `  duplicate of #${original}\n`);
  assert.equal(formatDuplicateLinks(duplicateLinks(db, original)), `  duplicates: #${copy}\n`);
});

test('close: the assignee can cancel with a reason', (t) => {
  const { root, copy } = makeBoard(t);
  runTeamCli(['task', 'claim', String(copy), '--as=@alice'], false, root);
  const res = close(root, copy, '--cancel=superseded by a redesign', '@alice');
  assert.equal(res.success, true);
  const db = readDb(root);
  assert.equal(getTask(db, copy).status, 'cancelled');
  assert.match(queryFeed(db, { task_id: copy }).at(-1).message, /superseded by a redesign/);
});

test('close: a dependent of a closed task is no longer blocked', (t) => {
  const { root, original, copy } = makeBoard(t);
  const dependent = runTeamCli(['task', 'add', 'waits on the copy', '--as=@orch'], false, root).id;
  close(root, copy, `--duplicate-of=${original}`, '@orch');
  const db = readDb(root);
  db.prepare('UPDATE agent_tasks SET dependencies = ? WHERE id = ?').run(JSON.stringify([copy]), dependent);
  assert.equal(checkDependenciesMet(db, dependent, getTask), true);
  db.prepare('UPDATE agent_tasks SET dependencies = ? WHERE id = ?').run(JSON.stringify([original]), dependent);
  assert.equal(checkDependenciesMet(db, dependent, getTask), false);
});

test('close: a closed task leaves the default list and dispatch', (t) => {
  const { root, copy } = makeBoard(t);
  close(root, copy, '--cancel=not needed', '@orch');
  const listed = runTeamCli(['task', 'list', '--json'], false, root);
  const db = readDb(root);
  assert.equal(JSON.stringify(listed).includes('same bug again'), false);
  assert.equal(selectDispatchTasks(db).some((task) => task.id === copy), false);
});

test('close: a stranger is refused and the task stays open', (t) => {
  const { root, copy } = makeBoard(t);
  const res = close(root, copy, '--cancel=nope', '@stranger');
  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_authorized');
  const db = readDb(root);
  assert.equal(getTask(db, copy).status, 'queued');
});

test('close: refuses unknown targets, self duplicates, done tasks and a missing mode', (t) => {
  const { root, copy, original } = makeBoard(t);
  assert.equal(close(root, copy, '--duplicate-of=9999', '@orch').reason, 'duplicate_target_not_found');
  assert.equal(close(root, copy, `--duplicate-of=${copy}`, '@orch').reason, 'self_duplicate');
  assert.equal(runTeamCli(['task', 'close', String(copy), '--as=@orch'], false, root).reason, 'missing_args');
  assert.equal(close(root, 9999, '--cancel=x', '@orch').reason, 'task_not_found');
  assert.equal(close(root, original, '--cancel=x', '@orch').success, true);
  assert.equal(close(root, original, '--cancel=x', '@orch').reason, 'already_closed');
});
