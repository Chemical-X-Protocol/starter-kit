/**
 * Dispatcher authority (#4567): a run's recorded dispatcher may hand off or close its run's tasks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { claimTask, getTask } from './team-db-tasks.js';
import { queryFeed } from './team-db-feed.js';
import { recordRun } from './team-dispatch-runs.js';
import { runTeamCli } from './team-commands.js';

delete process.env.CHEMX_PROJECT_ROOT;

const route = { model: 'sonnet', effort: 'low' };

const makeRun = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatcher-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openIndexDb(root, { fresh: true });
  const inRun = runTeamCli(['task', 'add', 'in run', '--as=@creator'], false, root);
  const outside = runTeamCli(['task', 'add', 'not in run', '--as=@creator'], false, root);
  claimTask(db, inRun.id, `@run-${inRun.id}-repair`);
  claimTask(db, outside.id, '@someone');
  const plan = {
    run: 'run-x', dispatcher: '@orch', template: 'dispatch-v1', lanes: [[inRun.id]], gate: route,
    tasks: [{ id: inRun.id, needs: 'light', build: route, review: route, repair: route, target: 'x.js', handle: `@run-${inRun.id}` }]
  };
  recordRun(db, plan);
  return { root, db, inRun: inRun.id, outside: outside.id };
};

test('dispatcher hands off a run task held by a run handle, recorded as by dispatcher', (t) => {
  const { root, db, inRun } = makeRun(t);
  const res = runTeamCli(['task', 'handoff', String(inRun), '@orch', '--as=@orch'], false, root);
  assert.equal(res.success, true);
  assert.equal(getTask(db, inRun).assigned_agent_id, '@orch');
  const events = queryFeed(db, { taskId: inRun });
  assert.ok(events.some((e) => e.event_type === 'task_handoff' && e.message.includes('by dispatcher of run run-x')));
});

test('dispatcher closes a run task', (t) => {
  const { root, db, inRun } = makeRun(t);
  const res = runTeamCli(['task', 'close', String(inRun), '--cancel=agent finished', '--as=@orch'], false, root);
  assert.equal(res.success, true);
  assert.equal(getTask(db, inRun).status, 'cancelled');
});

test('dispatcher has no authority over a task outside the run', (t) => {
  const { root, outside } = makeRun(t);
  const res = runTeamCli(['task', 'close', String(outside), '--cancel=nope', '--as=@orch'], false, root);
  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_authorized');
});

test('a handle other than the dispatcher has no authority over a run task', (t) => {
  const { root, inRun } = makeRun(t);
  const res = runTeamCli(['task', 'handoff', String(inRun), '@bob', '--as=@stranger'], false, root);
  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_authorized');
});