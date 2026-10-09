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
