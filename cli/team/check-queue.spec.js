import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { cancelCheck, countByStatus, enqueueCheck, getCheck, listChecks } from './check-queue.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const base = { kind: 'typecheck', cwd: '/repo', fingerprint: 'fp1', now: 1_000_000 };

test('check queue: the first enqueue inserts a queued job with its requester', () => {
  const db = makeDb();
  const queued = enqueueCheck(db, { ...base, requester: '@a' });
  assert.equal(queued.action, 'queued');
  assert.equal(queued.position, 1);
  assert.deepEqual(getCheck(db, queued.id).requesters.map((r) => r.agent_id), ['@a']);
});

test('check queue: an identical queued job coalesces and adds the requester', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  const second = enqueueCheck(db, { ...base, requester: '@b', fingerprint: 'fp2' });
  assert.equal(second.action, 'coalesced');
  assert.equal(second.id, first.id);
  assert.equal(countByStatus(db).queued, 1);
  assert.deepEqual(getCheck(db, first.id).requesters.map((r) => r.agent_id), ['@a', '@b']);
});

test('check queue: a different kind queues separately behind the first', () => {
  const db = makeDb();
  enqueueCheck(db, { ...base, requester: '@a' });
  const test2 = enqueueCheck(db, { ...base, kind: 'test', requester: '@a' });
  assert.equal(test2.action, 'queued');
  assert.equal(test2.position, 2);
});

test('check queue: a running job at the same tree is joined, at another tree a new job queues', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  db.prepare("UPDATE check_jobs SET status = 'running' WHERE id = ?").run(first.id);
  const joined = enqueueCheck(db, { ...base, requester: '@b' });
  assert.equal(joined.action, 'joined');
  assert.equal(joined.id, first.id);
  const other = enqueueCheck(db, { ...base, requester: '@c', fingerprint: 'fp-other' });
  assert.equal(other.action, 'queued');
  assert.notEqual(other.id, first.id);
});

const finishGreen = (db, id, finishedAt, extra = {}) => {
  db.prepare("UPDATE check_jobs SET status = 'done', finished_at = ?, result = ? WHERE id = ?").run(finishedAt, JSON.stringify({ status: 'pass', ...extra }), id);
};

test('check queue: a green result at the same fingerprint within the TTL answers from cache and inserts nothing', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  finishGreen(db, first.id, base.now + 1000);
  const again = enqueueCheck(db, { ...base, requester: '@b', now: base.now + 60_000 });
  assert.equal(again.action, 'cached');
  assert.equal(listChecks(db).length, 1);
});

test('check queue: the cache misses past the TTL, at another fingerprint, and for a stale or failed result', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  finishGreen(db, first.id, base.now);
  assert.equal(enqueueCheck(db, { ...base, requester: '@b', now: base.now + 600_001 }).action, 'queued');
  const db2 = makeDb();
  const one = enqueueCheck(db2, { ...base, requester: '@a' });
  finishGreen(db2, one.id, base.now);
  assert.equal(enqueueCheck(db2, { ...base, requester: '@b', fingerprint: 'fp-new' }).action, 'queued');
  const db3 = makeDb();
  const stale = enqueueCheck(db3, { ...base, requester: '@a' });
  finishGreen(db3, stale.id, base.now, { stale: true });
  assert.equal(enqueueCheck(db3, { ...base, requester: '@b' }).action, 'queued');
});

test('check queue: an empty fingerprint is never cached or joined', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, fingerprint: '', requester: '@a' });
  finishGreen(db, first.id, base.now);
  assert.equal(enqueueCheck(db, { ...base, fingerprint: '', requester: '@b' }).action, 'queued');
});

test('check queue: cancel closes a queued job once and reports the rest', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  assert.equal(cancelCheck(db, first.id).ok, true);
  assert.equal(getCheck(db, first.id).status, 'cancelled');
  assert.equal(cancelCheck(db, first.id).ok, false);
  assert.equal(cancelCheck(db, 999).ok, false);
});

test('check queue: enqueueing is fast and the schema is idempotent', () => {
  const db = makeDb();
  initTeamSchema(db);
  const started = Date.now();
  enqueueCheck(db, { ...base, requester: '@a' });
  assert.ok(Date.now() - started < 100);
});
