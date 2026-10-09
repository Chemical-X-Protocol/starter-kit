/**
 * Lease fairness (#2566): while someone waits, activity renewal stops extending a lease the holder has
 * not edited for the cap; the holder is told once; a capped lease cannot be retaken by an edit; contested
 * leases show their waiters. Temp projects, an injected clock for every renewal, no real waiting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, cleanExpiredLeases } from './team-db-locks.js';
import { renewHolderLeases } from './lease-activity.js';
import { renewLeasesAfterEdit } from './lease-renew.js';
import { reacquireLapsedAfterEdit } from './lease-reacquire.js';
import { contentionOf, leaseCapMs, DEFAULT_LEASE_CAP_MS } from './lease-cap.js';
import { describeContention, contentionByPath } from './lease-contention.js';
import { runLockList, runLockStatus } from './team-commands-lock-views.js';
import { findForeignLease } from '../edit-locks.js';

const MIN = 60 * 1000;
const TTL = 5 * MIN;
const HOLDER = '@spec-holder';
const WAITER = '@spec-waiter';

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-cap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx')); // pins the db to this temp project (see friction #2572)
  return { root, db: openIndexDb(root, { fresh: true }), base: Date.now() };
};

// The holder takes the file, then the row is pinned to the test clock: acquired at base, live for 15 minutes.
const hold = (ctx, file, holder = HOLDER) => {
  requestFileLock(ctx.db, file, holder, { cwd: ctx.root, ttlMs: 15 * MIN });
  ctx.db.prepare('UPDATE file_leases SET acquired_at = ?, expires_at = ? WHERE file_path = ?').run(ctx.base, ctx.base + 15 * MIN, file);
};
const queueFor = (ctx, file, waiter = WAITER) => requestFileLock(ctx.db, file, waiter, { cwd: ctx.root });
const setExpiry = (ctx, file, at) => ctx.db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(at, file);
const expiryOf = (ctx, file) => Number(ctx.db.prepare('SELECT expires_at FROM file_leases WHERE file_path = ?').get(file).expires_at);
const renewAt = (ctx, at) => renewHolderLeases(ctx.root, HOLDER, { ttlMs: TTL, now: ctx.base + at });
const holderDms = (ctx) => ctx.db.prepare("SELECT * FROM agent_feed WHERE event_type = 'dm' AND recipient_id = ?").all(HOLDER);
const captureStdout = (run) => {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { run(); } finally { process.stdout.write = original; }
  return out;
};

test('with no waiter, activity renewal keeps extending a lease past the cap', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');
  setExpiry(ctx, 'src/a.js', ctx.base + TTL);

  for (const at of [4 * MIN, 8 * MIN, 12 * MIN, 16 * MIN]) renewAt(ctx, at);

  assert.equal(expiryOf(ctx, 'src/a.js'), ctx.base + 16 * MIN + TTL, 'still renewing at 16 min with a 10 min cap');
});

test('with a waiter, renewal stops at the cap, the lease lapses, and the waiter gets the file', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');
  setExpiry(ctx, 'src/a.js', ctx.base + TTL);
  const queued = queueFor(ctx, 'src/a.js');
  assert.equal(queued.queued, true);

  renewAt(ctx, 4 * MIN);
  assert.equal(expiryOf(ctx, 'src/a.js'), ctx.base + 9 * MIN, 'before the cap: now + TTL');
  renewAt(ctx, 8 * MIN);
  assert.equal(expiryOf(ctx, 'src/a.js'), ctx.base + 10 * MIN, 'held back to last edit + cap');
  renewAt(ctx, 9 * MIN + 30 * 1000);
  assert.equal(expiryOf(ctx, 'src/a.js'), ctx.base + 10 * MIN, 'no further extension');

  const cleaned = cleanExpiredLeases(ctx.db, ctx.base + 11 * MIN);
  assert.equal(cleaned.length, 1);
  const now = ctx.db.prepare('SELECT locked_by FROM file_leases WHERE file_path = ?').get('src/a.js');
  assert.equal(now.locked_by, WAITER, 'the lapse promoted the first waiter');
});

test('the cap counts from the holder\'s last edit of that file, and the cap is configurable', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');
  queueFor(ctx, 'src/a.js');
  const abs = path.join(ctx.root, 'src/a.js');

  renewLeasesAfterEdit(ctx.root, [abs], HOLDER, { ttlMs: TTL, now: ctx.base + 8 * MIN });
  const lease = ctx.db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get('src/a.js');
  assert.equal(contentionOf(ctx.db, lease, ctx.base + 9 * MIN).capAt, ctx.base + 18 * MIN);

  renewHolderLeases(ctx.root, HOLDER, { ttlMs: TTL, now: ctx.base + 12 * MIN, capMs: 2 * MIN });
  assert.ok(expiryOf(ctx, 'src/a.js') >= ctx.base + 13 * MIN, 'a held-back target never shortens a longer lease');
  assert.equal(leaseCapMs({}, {}), DEFAULT_LEASE_CAP_MS);
  assert.equal(leaseCapMs({}, { CHEMX_LEASE_CAP_MINUTES: '3' }), 3 * MIN);
  assert.equal(leaseCapMs({ capMs: 7 }, { CHEMX_LEASE_CAP_MINUTES: '3' }), 7);
});

test('queuing DMs the holder once per waiter and file, and tells the waiter', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');

  const first = queueFor(ctx, 'src/a.js');
  assert.equal(first.holderNotified, true);
  assert.equal(first.noticeSent, true);
  assert.equal(first.notifiedHolder, HOLDER);
  const again = queueFor(ctx, 'src/a.js');
  assert.equal(again.requeued, true);
  assert.equal(again.holderNotified, true, 'the waiter is told the holder knows');
  assert.equal(again.noticeSent, false, 'but nothing is sent twice');

  const dms = holderDms(ctx);
  assert.equal(dms.length, 1);
  assert.equal(dms[0].author_id, WAITER);
  assert.match(dms[0].message, /@spec-waiter is waiting for src\/a\.js since \d\d:\d\d; commit and release it when your edit is in/);
  assert.match(dms[0].message, /--release/);
  assert.match(dms[0].message, /10 min after your last edit/);

  queueFor(ctx, 'src/a.js', '@spec-second');
  assert.equal(holderDms(ctx).length, 2, 'a different waiter is a different notice');
  hold(ctx, 'src/b.js');
  queueFor(ctx, 'src/b.js');
  assert.equal(holderDms(ctx).length, 3, 'a different file is a different notice');
});

test('a capped lease cannot be retaken by its holder while someone waits, and can when nobody does', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');
  hold(ctx, 'src/free.js');
  queueFor(ctx, 'src/a.js');
  setExpiry(ctx, 'src/a.js', ctx.base - MIN);
  setExpiry(ctx, 'src/free.js', ctx.base - MIN);
  const contested = path.join(ctx.root, 'src/a.js');
  const free = path.join(ctx.root, 'src/free.js');

  const refusal = findForeignLease(ctx.root, contested, HOLDER);
  assert.equal(refusal.lapsedOwn, true);
  assert.deepEqual(refusal.queue, [WAITER]);
  assert.deepEqual(reacquireLapsedAfterEdit(ctx.root, [contested], HOLDER, { now: Date.now() }), [], 'not retaken');
  assert.equal(findForeignLease(ctx.root, contested, WAITER), null, 'the waiter is not blocked by it');

  assert.equal(findForeignLease(ctx.root, free, HOLDER), null, 'no waiter: the edit is allowed');
  assert.equal(reacquireLapsedAfterEdit(ctx.root, [free], HOLDER, { now: Date.now() }).length, 1, 'no waiter: retaken');
});

test('lock list, lock status and chemx status data show waiters and the cap time', (t) => {
  const ctx = makeProject(t);
  hold(ctx, 'src/a.js');
  hold(ctx, 'src/quiet.js');
  queueFor(ctx, 'src/a.js');

  const list = runLockList(ctx.db, {}, false);
  const contested = list.leases.find((lease) => lease.file_path === 'src/a.js');
  assert.deepEqual(contested.waiters, [WAITER]);
  assert.equal(contested.renewalCapAt, ctx.base + DEFAULT_LEASE_CAP_MS);
  assert.equal(list.leases.find((lease) => lease.file_path === 'src/quiet.js').waiters, undefined);
  const listed = captureStdout(() => runLockList(ctx.db, {}, true));
  assert.match(listed, /src\/a\.js .*waiting: @spec-waiter \(since \d\d:\d\d:\d\d\); renewal (stops|stopped) extending at \d\d:\d\d:\d\d/);
  assert.doesNotMatch(listed.split('\n').find((line) => line.startsWith('src/quiet.js')), /waiting/);

  const status = runLockStatus(ctx.db, 'src/a.js', {}, false, ctx.root);
  assert.equal(status.renewalCapAt, ctx.base + DEFAULT_LEASE_CAP_MS);
  assert.match(captureStdout(() => runLockStatus(ctx.db, 'src/a.js', {}, true, ctx.root)), /1\. @spec-waiter waiting since .*\n  waiting: @spec-waiter/);

  const byPath = contentionByPath(ctx.root, ctx.base + MIN);
  assert.equal(byPath.has(path.join(ctx.root, 'src/a.js')), true);
  assert.equal(byPath.has(path.join(ctx.root, 'src/quiet.js')), false);
  const text = describeContention({ waiters: [{ agent_id: WAITER, requested_at: ctx.base }], capAt: ctx.base, isCapped: true });
  assert.match(text, /renewal stopped extending at/);
});
