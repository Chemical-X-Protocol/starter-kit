import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { initChecksSchema } from './team-schema-checks.js';
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

const deepReader = (value, counter) => () => {
  counter.reads += 1;
  return value;
};

test('check queue: a cached green result is trusted only when the deep fingerprint still matches, and the deep one is read only for a candidate', () => {
  const db = makeDb();
  const counter = { reads: 0 };
  const first = enqueueCheck(db, { ...base, requester: '@a', deepFingerprint: deepReader('D1', counter) });
  assert.equal(counter.reads, 0);
  finishGreen(db, first.id, base.now);
  db.prepare("UPDATE check_jobs SET tree_fp_deep = 'D1' WHERE id = ?").run(first.id);
  const hit = enqueueCheck(db, { ...base, requester: '@b', now: base.now + 1000, deepFingerprint: deepReader('D1', counter) });
  assert.equal(hit.action, 'cached');
  assert.equal(counter.reads, 1);
  const changedSubmodule = enqueueCheck(db, { ...base, requester: '@c', now: base.now + 1000, deepFingerprint: deepReader('D2', counter) });
  assert.equal(changedSubmodule.action, 'queued');
});

test('check queue: a deep fingerprint git could not read never validates a cached result', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  finishGreen(db, first.id, base.now);
  db.prepare("UPDATE check_jobs SET tree_fp_deep = '' WHERE id = ?").run(first.id);
  const unreadable = enqueueCheck(db, { ...base, requester: '@b', now: base.now + 1000, deepFingerprint: () => '' });
  assert.equal(unreadable.action, 'queued');
});

test('check queue: a candidate the worker never deep-stamped is not trusted when a deep fingerprint is supplied', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  finishGreen(db, first.id, base.now);
  const again = enqueueCheck(db, { ...base, requester: '@b', now: base.now + 1000, deepFingerprint: () => 'D1' });
  assert.equal(again.action, 'queued');
});

test('check queue: a running job is joined only while the deep fingerprint matches', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  db.prepare("UPDATE check_jobs SET status = 'running', tree_fp_deep = 'D1' WHERE id = ?").run(first.id);
  assert.equal(enqueueCheck(db, { ...base, requester: '@b', deepFingerprint: () => 'D1' }).action, 'joined');
  assert.equal(enqueueCheck(db, { ...base, requester: '@c', deepFingerprint: () => 'D2' }).action, 'queued');
});

test('check queue: cancelling records who cancelled and returns the job for its requesters', () => {
  const db = makeDb();
  const first = enqueueCheck(db, { ...base, requester: '@a' });
  const outcome = cancelCheck(db, first.id, { by: '@boss' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.id, first.id);
  assert.equal(getCheck(db, first.id).result.cancelledBy, '@boss');
  assert.equal(getCheck(db, first.id).result.status, 'cancelled');
});

test('check queue: the deep fingerprint column is added to a check_jobs table created before it existed', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE check_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, cwd TEXT NOT NULL, command TEXT NOT NULL, args TEXT NOT NULL DEFAULT '[]', tree_fp TEXT NOT NULL DEFAULT '', release TEXT NOT NULL DEFAULT '', gate TEXT NOT NULL DEFAULT 'none', run_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 2, requested_by TEXT NOT NULL, coalesced_into INTEGER, attempts INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 0, worker_token TEXT, worker_pid INTEGER NOT NULL DEFAULT 0, child_pid INTEGER NOT NULL DEFAULT 0, reason_held TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, result TEXT NOT NULL DEFAULT '{}')");
  initChecksSchema(db);
  initChecksSchema(db);
  const columns = db.prepare('PRAGMA table_info(check_jobs)').all().map((column) => column.name);
  assert.ok(columns.includes('tree_fp_deep'));
});
