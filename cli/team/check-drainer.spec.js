import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { enqueueCheck, getCheck } from './check-queue.js';
import { LEASE_STALE_MS, acquireLease, drainerStatus, ensureDrainer, heartbeat, recoverOrphans, runDrainer } from './check-drainer.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const makeClock = (start = 5_000_000) => {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
};

const queue = (db, kind, requester = '@a', fingerprint = '') => enqueueCheck(db, { kind, cwd: '/repo', requester, fingerprint, now: 1 });
const pass = { status: 'pass', durationMs: 5, faults: [], errorCount: 0 };

const drainOnce = (db, executor, deliver = () => {}, extra = {}) => runDrainer(db, { executor, deliver, clock: makeClock(), sleep: async () => {}, fingerprint: () => 'fp', isAlive: () => true, once: true, ...extra });

test('drainer: runs queued jobs one at a time in order and delivers each', async () => {
  const db = makeDb();
  const first = queue(db, 'typecheck');
  const second = queue(db, 'test');
  const order = [];
  const delivered = [];
  const executor = async (job) => { order.push(job.kind); return pass; };
  const outcome = await drainOnce(db, executor, (_db, job, result) => delivered.push([job.id, result.status]));
  assert.deepEqual(order, ['typecheck', 'test']);
  assert.equal(outcome.ran, 2);
  assert.deepEqual(delivered, [[first.id, 'pass'], [second.id, 'pass']]);
  assert.equal(getCheck(db, first.id).status, 'done');
});

test('drainer: a failing or throwing executor is failed or inconclusive, never a pass', async () => {
  const db = makeDb();
  const failing = queue(db, 'typecheck');
  const throwing = queue(db, 'test');
  await drainOnce(db, async (job) => {
    if (job.kind === 'test') throw new Error('boom');
    return { status: 'fail', faults: [{ file: 'a.ts', line: 1, code: 'TS1', message: 'x' }], errorCount: 1 };
  });
  assert.equal(getCheck(db, failing.id).status, 'failed');
  const thrown = getCheck(db, throwing.id);
  assert.equal(thrown.status, 'failed');
  assert.equal(thrown.result.status, 'inconclusive');
  assert.equal(thrown.result.summaryLine, 'boom');
});

test('drainer: a tree that changed while the check ran marks the result stale', async () => {
  const db = makeDb();
  const job = queue(db, 'typecheck');
  let calls = 0;
  await drainOnce(db, async () => pass, () => {}, { fingerprint: () => `fp${calls++}` });
  assert.equal(getCheck(db, job.id).result.stale, true);
});

test('drainer: a cancelled running job discards its result and is not delivered', async () => {
  const db = makeDb();
  const job = queue(db, 'typecheck');
  const delivered = [];
  await drainOnce(db, async () => {
    db.prepare("UPDATE check_jobs SET status = 'cancelled' WHERE id = ?").run(job.id);
    return pass;
  }, (_db, j) => delivered.push(j.id));
  assert.equal(getCheck(db, job.id).status, 'cancelled');
  assert.deepEqual(delivered, []);
});

test('drainer: only one holder gets the lease; a stale heartbeat or dead pid is taken over', () => {
  const db = makeDb();
  const clock = makeClock();
  assert.equal(acquireLease(db, { pid: 1, token: 'a', now: clock(), isAlive: () => true }), true);
  assert.equal(acquireLease(db, { pid: 2, token: 'b', now: clock(), isAlive: () => true }), false);
  assert.equal(acquireLease(db, { pid: 2, token: 'b', now: clock(), isAlive: (pid) => pid !== 1 }), true);
  assert.equal(heartbeat(db, 'a', clock()), false);
  assert.equal(heartbeat(db, 'b', clock()), true);
  clock.advance(LEASE_STALE_MS + 1);
  assert.equal(acquireLease(db, { pid: 3, token: 'c', now: clock(), isAlive: () => true }), true);
});

test('drainer: a second worker exits at once while the first holds the lease', async () => {
  const db = makeDb();
  acquireLease(db, { pid: 1, token: 'a', now: 5_000_000, isAlive: () => true });
  const outcome = await drainOnce(db, async () => pass);
  assert.equal(outcome.exited, 'lease-held');
});

test('drainer: ensureDrainer spawns only when no live worker holds the lease', () => {
  const db = makeDb();
  const spawned = [];
  const spawnWorker = (cwd) => spawned.push(cwd);
  assert.equal(ensureDrainer(db, { cwd: '/repo', now: 10, spawnWorker }).spawned, true);
  acquireLease(db, { pid: 1, token: 'a', now: 10, isAlive: () => true });
  assert.equal(ensureDrainer(db, { cwd: '/repo', now: 20, isAlive: () => true, spawnWorker }).spawned, false);
  assert.equal(ensureDrainer(db, { cwd: '/repo', now: 20, isAlive: () => false, spawnWorker }).spawned, true);
  assert.equal(drainerStatus(db, 20, () => true).running, true);
  assert.equal(spawned.length, 2);
});

test('drainer: a job orphaned by a dead worker is requeued once, then failed with a DM', async () => {
  const db = makeDb();
  const job = queue(db, 'typecheck');
  db.prepare("UPDATE check_jobs SET status = 'running', attempts = 1 WHERE id = ?").run(job.id);
  assert.deepEqual(recoverOrphans(db, 10), []);
  assert.equal(getCheck(db, job.id).status, 'queued');
  db.prepare("UPDATE check_jobs SET status = 'running', attempts = 2 WHERE id = ?").run(job.id);
  const delivered = [];
  await drainOnce(db, async () => pass, (_db, j, result) => delivered.push([j.id, result.reason]));
  assert.equal(getCheck(db, job.id).status, 'failed');
  assert.deepEqual(delivered, [[job.id, 'worker-crash']]);
});

test('drainer: it exits after the idle period and re-checks for a racing enqueue before exiting', async () => {
  const db = makeDb();
  const clock = makeClock();
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); clock.advance(ms); };
  const outcome = await runDrainer(db, { executor: async () => pass, deliver: () => {}, clock, sleep, fingerprint: () => 'fp', isAlive: () => true, idleExitMs: 3000 });
  assert.equal(outcome.exited, 'idle');
  assert.ok(sleeps.length >= 2);
  assert.equal(drainerStatus(db, clock(), () => true).running, false);
  // an enqueue that lands during the final re-check keeps the worker alive
  const racing = makeDb();
  const rclock = makeClock();
  let injected = false;
  const rsleep = async (ms) => {
    rclock.advance(ms);
    const isLastIdleTick = rclock() - 5_000_000 >= 2000 && !injected;
    if (isLastIdleTick) { injected = true; queue(racing, 'build'); }
  };
  const ran = [];
  await runDrainer(racing, { executor: async (job) => { ran.push(job.kind); return pass; }, deliver: () => {}, clock: rclock, sleep: rsleep, fingerprint: () => 'fp', isAlive: () => true, idleExitMs: 3000 });
  assert.deepEqual(ran, ['build']);
});
