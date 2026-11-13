import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { enqueueCheck } from './check-queue.js';
import { deliverCheckResult, formatFailure, redeliverUnnotified } from './check-delivery.js';
import { collectFaults, createCheckExecutor, toCheckResult } from './check-executor.js';

const makeJob = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const queued = enqueueCheck(db, { kind: 'typecheck', cwd: '/repo', requester: '@a', now: 1 });
  enqueueCheck(db, { kind: 'typecheck', cwd: '/repo', requester: '@b', now: 1 });
  return { db, job: queued.job };
};

const recorder = () => {
  const calls = { dms: [], posts: [] };
  return { calls, send: (_db, dm) => calls.dms.push(dm), post: (_db, event) => calls.posts.push(event) };
};

test('delivery: a pass is one line to each requester and nothing on the board', () => {
  const { db, job } = makeJob();
  const { calls, send, post } = recorder();
  deliverCheckResult(db, job, { status: 'pass', durationMs: 1500 }, { send, post });
  assert.equal(calls.dms.length, 2);
  assert.equal(calls.dms[0].message, `check #${job.id} typecheck PASS (1.5s)`);
  assert.deepEqual(calls.posts, []);
  assert.deepEqual(calls.dms.map((dm) => dm.recipient_id), ['@a', '@b']);
});

test('delivery: a fail lists the count and up to 25 faults, posts once to the board and DMs every requester', () => {
  const { db, job } = makeJob();
  const faults = Array.from({ length: 30 }, (_, i) => ({ file: `f${i}.ts`, line: i + 1, code: 'TS2322', message: 'bad' }));
  const { calls, send, post } = recorder();
  deliverCheckResult(db, job, { status: 'fail', errorCount: 30, faults: faults.slice(0, 25) }, { send, post });
  const text = calls.dms[0].message;
  assert.match(text, /FAIL: 30 fault\(s\)/);
  assert.match(text, /f0\.ts:1 TS2322 bad/);
  assert.match(text, /\+5 more/);
  assert.equal(text.split('\n').filter((line) => line.startsWith('  f')).length, 25);
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].event_type, 'check_result');
  assert.equal(calls.dms.length, 2);
});

test('delivery: the DM reaches the real inbox and marks the requester notified', () => {
  const { db, job } = makeJob();
  deliverCheckResult(db, job, { status: 'pass', durationMs: 10 });
  const rows = db.prepare("SELECT recipient_id, author_id, event_type FROM agent_feed WHERE event_type = 'dm' ORDER BY id").all();
  assert.deepEqual(rows.map((r) => r.recipient_id), ['@a', '@b']);
  assert.equal(rows[0].author_id, '@check_runner');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_requesters WHERE notified_at IS NOT NULL').get().n, 2);
});

test('delivery: an inconclusive result reads as INCONCLUSIVE, never a pass', () => {
  const text = formatFailure({ id: 3, kind: 'test' }, { status: 'inconclusive', summaryLine: 'timed out', faults: [], errorCount: 0 });
  assert.match(text, /INCONCLUSIVE/);
});

test('executor: faults come from errors, failures and error-severity diagnostics, including a verify summary', () => {
  const report = { typecheck: { errors: [{ file: 'a.ts', line: 2, code: 'TS1', message: 'm' }] }, tests: { failures: [{ name: 't1', message: 'x' }] }, build: { diagnostics: [{ file: 'b.ts', severity: 'warning', message: 'w' }, { file: 'c.ts', severity: 'error', message: 'e' }] } };
  assert.deepEqual(collectFaults(report).map((f) => f.file), ['a.ts', 't1', 'c.ts']);
});

test('executor: a report maps to a result and an unknown status is inconclusive', () => {
  const result = toCheckResult({ status: 'fail', errorCount: 40, errors: Array.from({ length: 40 }, () => ({ file: 'a' })) }, Date.now());
  assert.equal(result.status, 'fail');
  assert.equal(result.faults.length, 25);
  assert.equal(result.more, 15);
  assert.equal(toCheckResult({}, Date.now()).status, 'inconclusive');
});

test('executor: it runs the audit for the job kind and refuses an unknown kind', async () => {
  const seen = [];
  const executor = createCheckExecutor({ typecheck: async (args, isCli, options) => { seen.push(options.cwd); return { status: 'pass' }; } });
  assert.equal((await executor({ kind: 'typecheck', cwd: '/repo' })).status, 'pass');
  assert.deepEqual(seen, ['/repo']);
  assert.equal((await executor({ kind: 'lint', cwd: '/repo' })).status, 'inconclusive');
});

const failing = { status: 'fail', errorCount: 1, faults: [{ file: 'a.ts', line: 1, code: 'TS1', message: 'bad' }] };

test('delivery: one requester whose DM fails does not stop the others, and only it is retried', () => {
  const { db, job } = makeJob();
  const sent = [];
  const send = (_db, dm) => {
    const isLocked = dm.recipient_id === '@a';
    const reject = () => { throw new Error('inbox locked'); };
    return isLocked ? reject() : sent.push(dm.recipient_id);
  };
  const outcome = deliverCheckResult(db, job, { status: 'pass' }, { send });
  assert.deepEqual(sent, ['@b']);
  assert.equal(outcome.dms, 1);
  assert.deepEqual(outcome.errors, ['dm @a: inbox locked']);
  const retry = [];
  deliverCheckResult(db, job, { status: 'pass' }, { send: (_db, dm) => retry.push(dm.recipient_id) });
  assert.deepEqual(retry, ['@a']);
});

test('delivery: the board post happens once, even when the first attempt failed or delivery runs again', () => {
  const { db, job } = makeJob();
  const posts = [];
  const flaky = { send: () => {}, post: () => { throw new Error('feed locked'); } };
  const first = deliverCheckResult(db, job, failing, flaky);
  assert.equal(first.posted, false);
  assert.equal(first.errors.length, 1);
  const recorder2 = { send: () => {}, post: (_db, event) => posts.push(event) };
  assert.equal(deliverCheckResult(db, job, failing, recorder2).posted, true);
  deliverCheckResult(db, job, failing, recorder2);
  assert.equal(posts.length, 1);
});

test('delivery: a process-scoped phantom handle is never DMed, and is not retried either', () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const queued = enqueueCheck(db, { kind: 'test', cwd: '/repo', requester: '@agent-4242-abcdef', now: 1 });
  enqueueCheck(db, { kind: 'test', cwd: '/repo', requester: '@real', now: 1 });
  const { calls, send, post } = recorder();
  const outcome = deliverCheckResult(db, queued.job, { status: 'pass' }, { send, post });
  assert.deepEqual(calls.dms.map((dm) => dm.recipient_id), ['@real']);
  assert.equal(outcome.skipped, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_requesters WHERE notified_at IS NULL').get().n, 0);
});

test('delivery: a cancelled check is a one-line DM saying who cancelled it, and nothing goes to the board', () => {
  const { db, job } = makeJob();
  const { calls, send, post } = recorder();
  deliverCheckResult(db, job, { status: 'cancelled', cancelledBy: '@boss' }, { send, post });
  assert.match(calls.dms[0].message, /CANCELLED by @boss; no result will come/);
  assert.deepEqual(calls.posts, []);
});

test('delivery: the sweep redelivers finished jobs with an un-notified requester and survives a job that throws', () => {
  const { db, job } = makeJob();
  const other = enqueueCheck(db, { kind: 'build', cwd: '/repo', requester: '@c', now: 1 });
  db.prepare("UPDATE check_jobs SET status = 'done', finished_at = 2, result = ? WHERE id IN (?, ?)").run(JSON.stringify({ status: 'pass' }), job.id, other.id);
  const seen = [];
  const outcome = redeliverUnnotified(db, (_db, finished) => {
    seen.push(finished.id);
    const isFirst = finished.id === job.id;
    const reject = () => { throw new Error('boom'); };
    return isFirst ? reject() : undefined;
  });
  assert.deepEqual(seen, [job.id, other.id]);
  assert.deepEqual(outcome, { attempted: 2, failures: [{ id: job.id, error: 'boom' }] });
  db.prepare('UPDATE check_requesters SET notified_at = 3').run();
  assert.equal(redeliverUnnotified(db, () => assert.fail('nothing left to deliver')).attempted, 0);
});
