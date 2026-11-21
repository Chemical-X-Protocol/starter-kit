import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { cancelCheck, enqueueCheck, getCheck } from './check-queue.js';
import { deliverCheckResult } from './check-delivery.js';
import { ensureDrainer, runDrainer } from './check-drainer.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const queue = (db, kind, requester = '@a') => enqueueCheck(db, { kind, cwd: '/repo', requester, fingerprint: '', now: 1 });
const pass = { status: 'pass', durationMs: 5, faults: [], errorCount: 0 };

const drainOnce = (db, executor, deliver = () => {}, extra = {}) => runDrainer(db, { executor, deliver, clock: () => 5_000_000, sleep: async () => {}, fingerprint: () => 'fp', isAlive: () => true, once: true, ...extra });

const untilAborted = (signal, onAbort) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(onAbort()), { once: true }));

test('failure: ensureDrainer reports a spawn that throws instead of hiding it', () => {
  const db = makeDb();
  const outcome = ensureDrainer(db, { cwd: '/repo', spawnWorker: () => { throw new Error('spawn ENOENT'); } });
  assert.deepEqual(outcome, { spawned: false, error: 'spawn ENOENT' });
});

test('failure: cancelling a running job aborts its executor and discards the result', async () => {
  const db = makeDb();
  const job = queue(db, 'test');
  const delivered = [];
  let abortReason = null;
  const executor = (_job, { signal }) => {
    delay(5).then(() => cancelCheck(db, job.id, { by: '@canceller' }));
    return untilAborted(signal, () => { abortReason = signal.reason; return pass; });
  };
  await drainOnce(db, executor, (_db, j) => delivered.push(j.id), { cancelPollMs: 10 });
  assert.equal(abortReason, 'cancelled');
  assert.equal(getCheck(db, job.id).status, 'cancelled');
  assert.deepEqual(delivered, []);
});

test('failure: a job cancelled before the worker reaches the executor never runs it', async () => {
  const db = makeDb();
  const job = queue(db, 'test');
  let ran = 0;
  await drainOnce(db, async () => { ran += 1; return pass; }, () => {}, { fingerprint: () => { cancelCheck(db, job.id); return 'fp'; } });
  assert.equal(ran, 0);
  assert.equal(getCheck(db, job.id).status, 'cancelled');
});

test('failure: a worker that loses the lease aborts the executor and records nothing, so the job is recovered', async () => {
  const db = makeDb();
  const job = queue(db, 'typecheck');
  const delivered = [];
  const executor = (_job, { signal }) => {
    delay(5).then(() => db.prepare("UPDATE check_drainer SET token = 'another-worker' WHERE id = 1").run());
    return untilAborted(signal, () => pass);
  };
  const outcome = await drainOnce(db, executor, (_db, j) => delivered.push(j.id), { heartbeatMs: 10 });
  assert.equal(outcome.exited, 'lease-lost');
  assert.equal(getCheck(db, job.id).status, 'running');
  assert.deepEqual(delivered, []);
});

test('failure: a busy db during the heartbeat does not kill the worker or its job', async () => {
  const real = makeDb();
  const job = queue(real, 'build');
  const busy = { left: 3 };
  const flaky = {
    exec: (sql) => real.exec(sql),
    prepare: (sql) => {
      const isBeat = sql.includes('UPDATE check_drainer SET heartbeat');
      const shouldFail = isBeat && busy.left > 0;
      if (shouldFail) {
        busy.left -= 1;
        throw Object.assign(new Error('database is locked'), { errcode: 5 });
      }
      return real.prepare(sql);
    }
  };
  const outcome = await drainOnce(flaky, async () => { await delay(60); return pass; }, () => {}, { heartbeatMs: 5 });
  assert.equal(busy.left, 0);
  assert.equal(outcome.ran, 1);
  assert.equal(getCheck(real, job.id).status, 'done');
});

test('failure: a delivery that throws leaves the requester un-notified, keeps the worker going, and the next start redelivers', async () => {
  const db = makeDb();
  const first = queue(db, 'typecheck');
  const second = queue(db, 'test');
  const outcome = await drainOnce(db, async () => pass, () => { throw new Error('dm down'); });
  assert.equal(outcome.ran, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_requesters WHERE notified_at IS NULL').get().n, 2);
  await drainOnce(db, async () => pass, deliverCheckResult);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_requesters WHERE notified_at IS NULL').get().n, 0);
  const dms = db.prepare("SELECT message FROM agent_feed WHERE event_type = 'dm' ORDER BY id").all().map((row) => row.message);
  assert.equal(dms.length, 2);
  assert.match(dms[0], new RegExp(`check #${first.id} typecheck PASS`));
  assert.match(dms[1], new RegExp(`check #${second.id} test PASS`));
});

test('failure: a job finished by a worker that died before telling anyone is delivered when the next worker starts', async () => {
  const db = makeDb();
  const job = queue(db, 'verify');
  db.prepare("UPDATE check_jobs SET status = 'failed', finished_at = 2, result = ? WHERE id = ?").run(JSON.stringify({ status: 'fail', errorCount: 1, faults: [{ file: 'a.ts', line: 3, code: 'TS1', message: 'bad' }] }), job.id);
  const delivered = [];
  await drainOnce(db, async () => pass, (_db, j, result) => delivered.push([j.id, result.status]));
  assert.deepEqual(delivered, [[job.id, 'fail']]);
});

test('failure: the worker stamps the shallow and the deep fingerprint on the job and compares the deep one for staleness', async () => {
  const db = makeDb();
  const job = queue(db, 'typecheck');
  const calls = [];
  await drainOnce(db, async () => pass, () => {}, { fingerprint: (_cwd, { deep = false } = {}) => { calls.push(deep); return deep ? 'DEEP' : 'SHALLOW'; } });
  const row = getCheck(db, job.id);
  assert.equal(row.tree_fp, 'SHALLOW');
  assert.equal(row.tree_fp_deep, 'DEEP');
  assert.equal(row.result.stale, false);
  assert.deepEqual(calls, [false, true, true]);
});
