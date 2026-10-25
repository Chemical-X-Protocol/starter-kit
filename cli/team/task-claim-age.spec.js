/**
 * Claim age (K14, #6759): `task show` says when a claim was made and when its assignee was last active,
 * and `task list` marks a claim idle for more than six hours with "idle Nh".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { postFeedEvent } from './team-db-feed.js';
import { requestFileLock } from './team-db-locks.js';
import { IDLE_AFTER_MS, lastActivityByHandle, markIdleClaims, describeWhen } from './task-claim-age.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { stripAnsi } from '../terminal.js';

delete process.env.CHEMX_PROJECT_ROOT;

const HOUR = 3600000;
const NOW = Date.UTC(2026, 9, 25, 18, 0, 0);

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-claim-age-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openTeamContext(root).db };
};

// A claimed task whose every sign of life is `hoursAgo` before `at`.
const claimedTask = (root, db, handle, hoursAgo, at = NOW) => {
  const task = runTeamCli(['task', 'add', `Work of ${handle}`], false, root);
  runTeamCli(['task', 'claim', String(task.id), `--as=${handle}`], false, root);
  const then = at - hoursAgo * HOUR;
  db.prepare('UPDATE agent_tasks SET claimed_at = ?, updated_at = ? WHERE id = ?').run(then, then, task.id);
  db.prepare('UPDATE agents SET heartbeat = ? WHERE id = ?').run(then, handle);
  return task.id;
};

const captured = (run) => {
  const original = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
  return stripAnsi(output);
};

test('describeWhen: local date and time with how long ago', () => {
  assert.match(describeWhen(NOW - 20 * 1000, NOW), /\(just now\)$/);
  assert.match(describeWhen(NOW - 12 * 60000, NOW), /\(12m ago\)$/);
  assert.match(describeWhen(NOW - 3 * HOUR, NOW), /^\d{4}-\d\d-\d\d \d\d:\d\d \(3h ago\)$/);
  assert.match(describeWhen(NOW - 50 * HOUR, NOW), /\(2d ago\)$/);
});

test('lastActivityByHandle: the freshest of heartbeat, a feed post and a live lease', (t) => {
  const { root, db } = makeBoard(t);
  const at = Date.now();
  claimedTask(root, db, '@a', 9, at);
  claimedTask(root, db, '@b', 9, at);
  claimedTask(root, db, '@c', 9, at);
  const posted = postFeedEvent(db, { author_id: '@b', event_type: 'broadcast', message: 'still here' });
  db.prepare('UPDATE agent_feed SET timestamp = ? WHERE id = ?').run(at - 2 * HOUR, posted.id);
  requestFileLock(db, 'src/x.js', '@c', { cwd: root, purpose: '#3' });
  const seen = lastActivityByHandle(db, ['@a', '@b', '@c', '@nobody'], Date.now());
  assert.equal(seen.get('@a'), at - 9 * HOUR, 'only the heartbeat');
  assert.equal(seen.get('@b'), at - 2 * HOUR, 'a feed post is newer than the heartbeat');
  assert.ok(seen.get('@c') > at - HOUR, 'a live lease counts as activity');
  assert.equal(seen.has('@nobody'), false);
});

test('markIdleClaims: an in-progress claim idle for more than six hours gets idle_hours; nothing else does', (t) => {
  const { root, db } = makeBoard(t);
  const stale = claimedTask(root, db, '@stale', 9);
  const edge = claimedTask(root, db, '@edge', 6);
  const fresh = claimedTask(root, db, '@fresh', 1);
  const queued = runTeamCli(['task', 'add', 'Not claimed'], false, root).id;
  const rows = db.prepare('SELECT * FROM agent_tasks ORDER BY id').all();
  const marked = markIdleClaims(db, rows, NOW);
  const idleOf = (id) => marked.find((task) => task.id === id).idle_hours;
  assert.equal(idleOf(stale), 9);
  assert.equal(idleOf(edge), undefined, 'exactly six hours is not idle');
  assert.equal(idleOf(fresh), undefined);
  assert.equal(idleOf(queued), undefined);
  assert.equal(IDLE_AFTER_MS, 6 * HOUR);
  const post = postFeedEvent(db, { author_id: '@stale', event_type: 'status_update', message: 'back' });
  db.prepare('UPDATE agent_feed SET timestamp = ? WHERE id = ?').run(NOW - HOUR, post.id);
  assert.equal(markIdleClaims(db, rows, NOW).find((task) => task.id === stale).idle_hours, undefined, 'a post clears the mark');
});

test('task list prints "idle Nh" after the assignee and the JSON list gains an idle_hours column', (t) => {
  const { root, db } = makeBoard(t);
  claimedTask(root, db, '@stale', 9, Date.now());
  claimedTask(root, db, '@fresh', 0, Date.now());
  const text = captured(() => runTeamCli(['task', 'list'], true, root));
  assert.match(text, /\(@stale idle 9h\)/);
  assert.match(text, /\(@fresh\)/);
  const json = runTeamCli(['task', 'list', '--json'], false, root);
  assert.ok(json.cols.includes('idle_hours'));
});

test('task show prints when the claim was made and when the assignee was last active', async (t) => {
  const { root, db } = makeBoard(t);
  const id = claimedTask(root, db, '@worker', 3, Date.now());
  const card = captured(() => runTeamCli(['task', 'show', String(id)], true, root));
  assert.match(card, /Claimed:\s+\d{4}-\d\d-\d\d \d\d:\d\d \(3h ago\) │ Last active: \d{4}-\d\d-\d\d \d\d:\d\d \(3h ago\)/);
  const brief = captured(() => runTeamCli(['task', 'show', String(id), '--brief'], true, root));
  assert.match(brief, /claimed \d{4}-\d\d-\d\d \d\d:\d\d \(3h ago\) · @worker last active \d{4}-\d\d-\d\d \d\d:\d\d \(3h ago\)/);
  const json = runTeamCli(['task', 'show', String(id), '--json'], false, root);
  assert.equal(typeof json.claim.claimedAt, 'number');
  assert.equal(typeof json.claim.lastActiveAt, 'number');
  const shown = await handleChemxTeamTask({ action: 'show', taskId: id }, root);
  assert.match(stripAnsi(shown.card), /Claimed:/);
  assert.equal(typeof shown.claim.claimedAt, 'number');
});

test('task show of a claim made before claimed_at existed says the time was not recorded; a queued task has no claim line', (t) => {
  const { root, db } = makeBoard(t);
  const id = claimedTask(root, db, '@old', 2, Date.now());
  db.prepare('UPDATE agent_tasks SET claimed_at = NULL WHERE id = ?').run(id);
  const queued = runTeamCli(['task', 'add', 'Waiting'], false, root).id;
  assert.match(captured(() => runTeamCli(['task', 'show', String(id)], true, root)), /Claimed:\s+\(time not recorded\)/);
  assert.doesNotMatch(captured(() => runTeamCli(['task', 'show', String(queued)], true, root)), /Claimed:|Last active:/);
});
