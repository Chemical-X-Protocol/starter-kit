/**
 * Tasks: `task claim --ignore-deps=<reason>` through the CLI (#4428, follow-up to #2589).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getTask } from './team-db-tasks.js';
import { queryFeed } from './team-db-feed.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-claim-ignore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = runTeamCli(['task', 'add', 'parent', '--as=@orch'], false, root);
  const child = runTeamCli(['task', 'add', 'child', `--deps=${parent.id}`, '--as=@orch'], false, root);
  return { root, child: child.id };
};

const claim = (root, id, ...extra) => runTeamCli(['task', 'claim', String(id), '--as=@w1', ...extra], false, root);

test('claim: unmet dependencies refuse without --ignore-deps', (t) => {
  const { root, child } = makeBoard(t);
  assert.equal(claim(root, child).reason, 'dependencies_unmet');
});

test('claim: --ignore-deps=<reason> claims and records the reason in the task and the feed', (t) => {
  const { root, child } = makeBoard(t);
  const res = claim(root, child, '--ignore-deps=landed first');
  assert.equal(res.success, true);
  const db = openIndexDb(root);
  assert.equal(getTask(db, child).result_payload.deps_override.reason, 'landed first');
  assert.ok(queryFeed(db, { task_id: child }).some((e) => e.message.includes('landed first')));
});

test('claim: a bare or blank --ignore-deps is refused and the task stays unclaimed', (t) => {
  const { root, child } = makeBoard(t);
  for (const flag of ['--ignore-deps', '--ignore-deps=  ']) {
    const res = claim(root, child, flag);
    assert.match(res.error, /reason required/);
  }
  assert.notEqual(getTask(openIndexDb(root), child).status, 'in_progress');
});

test('claim: --ignore-deps on a task whose dependencies are met posts no override event', (t) => {
  const { root } = makeBoard(t);
  const solo = runTeamCli(['task', 'add', 'solo', '--as=@orch'], false, root);
  const res = claim(root, solo.id, '--ignore-deps=not needed');
  assert.equal(res.success, true);
  const db = openIndexDb(root);
  assert.equal(getTask(db, solo.id).result_payload.deps_override, undefined);
  assert.ok(!queryFeed(db, { task_id: solo.id }).some((e) => e.message.includes('ignoring unmet')));
});

const mcpClaim = (root, id, ignoreDeps) => handleChemxTeamTask({ action: 'claim', taskId: id, agentId: '@w2', ignoreDeps }, root);

test('mcp claim: ignoreDeps with a reason claims and records it in the task and the feed', async (t) => {
  const { root, child } = makeBoard(t);
  const res = await mcpClaim(root, child, 'landed first');
  assert.equal(res.success, true);
  const db = openIndexDb(root);
  assert.equal(getTask(db, child).result_payload.deps_override.reason, 'landed first');
  assert.ok(queryFeed(db, { task_id: child }).some((e) => e.message.includes('landed first')));
});

test('mcp claim: a blank or non-string ignoreDeps is refused with a reason-required error', async (t) => {
  const { root, child } = makeBoard(t);
  for (const bad of ['  ', true, 5]) {
    const res = await mcpClaim(root, child, bad);
    assert.equal(res.success, false);
    assert.match(res.error, /reason required/);
  }
  assert.notEqual(getTask(openIndexDb(root), child).status, 'in_progress');
});
