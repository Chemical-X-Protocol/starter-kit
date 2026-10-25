/**
 * The activity window (#6758): a lease that lapsed no more than 10 minutes ago (the holder's last chemx
 * call at most 15 minutes ago) comes back on the holder's next chemx command when the holder has a task
 * in_progress and nothing contests the file. Temp projects only; time is passed in, never slept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, cleanExpiredLeases } from './team-db-locks.js';
import { createTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { claimTask } from './team-db.js';
import { queryFeed } from './team-db-feed.js';
import { renewHolderLeases } from './lease-activity.js';
import { ACTIVE_WINDOW_MS, graceEarliest } from './lease-grace.js';
import { findLapse } from './lease-lapse.js';

const MIN = 60 * 1000;
const TTL = 5 * MIN;
const NOW = Date.now();

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-grace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const startTask = (db, handle) => {
  registerAgent(db, { id: handle, role: 'executor' });
  const task = createTask(db, { title: 'work' });
  assert.equal(claimTask(db, task.id, handle).success, true);
};

// A lease that lapsed `agoMin` minutes before NOW (its row is kept, expired).
const lapsedLease = (db, root, file, handle, agoMin, options = {}) => {
  requestFileLock(db, file, handle, { cwd: root, purpose: '#6758 work', ...options });
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(NOW - agoMin * MIN, file);
};

const rowOf = (db, file) => db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(file);
const renew = (root, handle = '@spec-a') => renewHolderLeases(root, handle, { ttlMs: TTL, now: NOW });

test('the window is 15 minutes since the last chemx call, so a lease may be 10 minutes past its expiry', () => {
  assert.equal(ACTIVE_WINDOW_MS, 15 * MIN);
  assert.equal(NOW - graceEarliest(NOW, TTL), 10 * MIN);
});

test('a lapsed lease inside the window, held by a handle with a task in_progress, is revived with its purpose', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  lapsedLease(db, root, 'src/a.js', '@spec-a', 4);

  const revived = renew(root);

  const row = rowOf(db, 'src/a.js');
  assert.equal(revived, 1);
  assert.equal(row.locked_by, '@spec-a');
  assert.equal(row.expires_at, NOW + TTL, 'a full TTL from now');
  assert.equal(row.purpose, '#6758 work', 'the purpose survives');
  const events = queryFeed(db, { file_path: 'src/a.js' });
  assert.ok(events.some((event) => event.event_type === 'lock_acquired' && /revived/.test(event.message)), 'the revival is in the feed');
  assert.equal(findLapse(db, 'src/a.js', '@spec-a'), null, 'the lapse no longer shows');
});

test('a lapse that cleanup already deleted is revived from the feed record, with the original purpose', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  lapsedLease(db, root, 'src/a.js', '@spec-a', 6);
  cleanExpiredLeases(db, NOW);
  assert.equal(rowOf(db, 'src/a.js'), undefined, 'cleanup removed the row');

  const revived = renew(root);

  const row = rowOf(db, 'src/a.js');
  assert.equal(revived, 1);
  assert.equal(row.locked_by, '@spec-a');
  assert.equal(row.purpose, '#6758 work');
  assert.equal(row.expires_at, NOW + TTL);
});

test('past the window the lease stays lapsed; just inside it comes back', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  // Both are taken first: every acquire cleans the expired rows it finds, so a row lapsed early would be gone.
  requestFileLock(db, 'src/late.js', '@spec-a', { cwd: root });
  requestFileLock(db, 'src/edge.js', '@spec-a', { cwd: root });
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(NOW - 11 * MIN, 'src/late.js');
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(NOW - 9 * MIN, 'src/edge.js');

  renew(root);

  assert.ok(rowOf(db, 'src/late.js').expires_at < NOW, '11 minutes past expiry: the last chemx call was over 15 minutes ago');
  assert.equal(rowOf(db, 'src/edge.js').expires_at, NOW + TTL);
});

test('without a task in_progress there is no revival', (t) => {
  const { root, db } = makeProject(t);
  registerAgent(db, { id: '@spec-a', role: 'executor' });
  lapsedLease(db, root, 'src/a.js', '@spec-a', 4);

  assert.equal(renew(root), 0);
  assert.ok(rowOf(db, 'src/a.js').expires_at < NOW);
});

test('a task that is only queued or done does not count as in_progress', (t) => {
  const { root, db } = makeProject(t);
  registerAgent(db, { id: '@spec-a', role: 'executor' });
  const task = createTask(db, { title: 'later' });
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@spec-a', status = 'done' WHERE id = ?").run(task.id);
  lapsedLease(db, root, 'src/a.js', '@spec-a', 4);

  assert.equal(renew(root), 0);
});

test('a file someone else took meanwhile is theirs, and another handle\'s lapse is not revived by this one', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  startTask(db, '@spec-b');
  lapsedLease(db, root, 'src/taken.js', '@spec-a', 4);
  cleanExpiredLeases(db, NOW);
  requestFileLock(db, 'src/taken.js', '@spec-b', { cwd: root, purpose: 'mine now' });
  lapsedLease(db, root, 'src/theirs.js', '@spec-b', 4);

  renew(root, '@spec-a');

  assert.equal(rowOf(db, 'src/taken.js').locked_by, '@spec-b');
  assert.equal(rowOf(db, 'src/theirs.js').locked_by, '@spec-b');
  assert.ok(rowOf(db, 'src/theirs.js').expires_at < NOW, '@spec-a\'s activity never touches @spec-b\'s lapse');
});

test('a file with a live waiter is not revived: it belongs to the first waiter', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  lapsedLease(db, root, 'src/a.js', '@spec-a', 4);
  db.prepare("INSERT INTO file_lock_queue (file_path, agent_id, requested_at, status, last_seen_at) VALUES (?, '@spec-w', ?, 'waiting', ?)").run('src/a.js', NOW - MIN, NOW - 1000);

  assert.equal(renew(root), 0);
  assert.ok(rowOf(db, 'src/a.js').expires_at < NOW);
});

test('a lease cleaned because its process died is not revived', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  lapsedLease(db, root, 'src/a.js', '@spec-a', 2, { pid: 2 ** 22 - 3 });
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(NOW + MIN, 'src/a.js');
  cleanExpiredLeases(db, NOW);
  assert.equal(rowOf(db, 'src/a.js'), undefined, 'cleanup removed the dead holder\'s lease');

  assert.equal(renew(root), 0);
  assert.equal(rowOf(db, 'src/a.js'), undefined);
});

test('an anonymous caller revives nothing', (t) => {
  const { root, db } = makeProject(t);
  startTask(db, '@spec-a');
  lapsedLease(db, root, 'src/a.js', '@spec-a', 4);

  assert.equal(renewHolderLeases(root, undefined, { env: {}, ttlMs: TTL, now: NOW }), 0);
  assert.ok(rowOf(db, 'src/a.js').expires_at < NOW);
});
