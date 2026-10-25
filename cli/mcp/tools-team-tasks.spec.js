/**
 * The chemx_team_task MCP tool: `action: 'update'` validates the status like `task update` on the CLI (K1b, #6765).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getTask } from '../team/team-db-tasks.js';
import { queryFeed } from '../team/team-db-feed.js';
import { runTeamCli } from '../team/team-commands.js';
import { TASK_UPDATE_STATUSES, describeUnknownStatus } from '../team/task-update-status.js';
import { handleChemxTeamTask } from './tools-team-tasks.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-task-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = runTeamCli(['task', 'add', 'status subject', '--as=@orch'], false, root);
  return { root, taskId: task.id };
};

const mcpUpdate = (root, taskId, extra = {}) => handleChemxTeamTask({ action: 'update', taskId, agentId: '@w1', ...extra }, root);

const claimAs = (root, taskId, agentId = '@w1') => handleChemxTeamTask({ action: 'claim', taskId, agentId }, root);

const BOGUS = ['1555,1556', 'finished', 'completed', 'duplicate', 'In_Progress', 'Done', '', 5, true];

test('update refuses a status the CLI refuses, with the CLI text, and writes nothing', async (t) => {
  const { root, taskId } = makeBoard(t);
  const db = openIndexDb(root);
  const before = getTask(db, taskId);
  const eventsBefore = queryFeed(db, { task_id: taskId }).length;
  for (const bogus of BOGUS) {
    const res = await mcpUpdate(root, taskId, { status: bogus });
    assert.equal(res.refused, true, `${JSON.stringify(bogus)} is refused`);
    assert.equal(res.error, describeUnknownStatus(bogus), 'the refusal is the CLI text');
    assert.match(res.error, /queued, in_progress, review, blocked, done, cancelled/);
  }
  const after = getTask(db, taskId);
  assert.equal(after.status, before.status);
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(queryFeed(db, { task_id: taskId }).length, eventsBefore);
});

test('update refuses the same word on the CLI and over MCP', async (t) => {
  const { root, taskId } = makeBoard(t);
  const viaCli = runTeamCli(['task', 'update', String(taskId), 'completed'], false, root);
  const viaMcp = await mcpUpdate(root, taskId, { status: 'completed' });
  assert.equal(viaMcp.error, viaCli.error);
  assert.equal(viaMcp.refused, viaCli.refused);
});

test('update no longer maps "completed" to done: the task is not completed', async (t) => {
  const { root, taskId } = makeBoard(t);
  await claimAs(root, taskId);
  const res = await mcpUpdate(root, taskId, { status: 'completed', noTargetConfirm: true });
  assert.match(res.error, /Unknown status "completed"/);
  assert.equal(getTask(openIndexDb(root), taskId).status, 'in_progress', 'claimed and not completed');
});

test('update accepts every status in the list, and defaults to in_progress without one', async (t) => {
  const { root, taskId } = makeBoard(t);
  const db = openIndexDb(root);
  for (const status of TASK_UPDATE_STATUSES.filter((word) => word !== 'done')) {
    const res = await mcpUpdate(root, taskId, { status });
    assert.equal(res.refused, undefined, `${status} is not refused`);
    assert.equal(getTask(db, taskId).status, status);
  }
  await mcpUpdate(root, taskId, { status: 'queued' });
  await mcpUpdate(root, taskId, {});
  assert.equal(getTask(db, taskId).status, 'in_progress', 'no status means in_progress, as on the CLI');
  await mcpUpdate(root, taskId, { status: null });
  assert.equal(getTask(db, taskId).status, 'in_progress', 'a null status is no status');
});

test('update with status done still completes the task', async (t) => {
  const { root, taskId } = makeBoard(t);
  await claimAs(root, taskId);
  const res = await mcpUpdate(root, taskId, { status: 'done', noTargetConfirm: true });
  assert.equal(res.refused, undefined, JSON.stringify(res));
  assert.equal(getTask(openIndexDb(root), taskId).status, 'done');
});

test('block still sets blocked with its reason', async (t) => {
  const { root, taskId } = makeBoard(t);
  await handleChemxTeamTask({ action: 'block', taskId, blockedReason: 'waiting on K9' }, root);
  assert.equal(getTask(openIndexDb(root), taskId).status, 'blocked');
});
