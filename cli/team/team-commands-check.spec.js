import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { handleCheckCommand } from './team-commands-check.js';
import { getCheck } from './check-queue.js';

const makeCtx = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return { db };
};

const run = (ctx, positionals, flags = {}, deps = {}, restArgs = []) => handleCheckCommand(ctx, { positionals, flags: { as: '@tester', ...flags }, restArgs }, false, '/repo', { fingerprint: () => 'fp', ensure: () => {}, ...deps });

test('team check: a kind enqueues and returns at once without waiting for a worker', () => {
  const ctx = makeCtx();
  let ensured = 0;
  const started = Date.now();
  const result = run(ctx, ['typecheck'], {}, { ensure: () => { ensured += 1; } });
  assert.ok(Date.now() - started < 100);
  assert.equal(result.action, 'queued');
  assert.equal(ensured, 1);
  assert.equal(getCheck(ctx.db, result.id).requested_by, '@tester');
});

test('team check: the message tells the agent to keep working and where the result goes', () => {
  const ctx = makeCtx();
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    handleCheckCommand(ctx, { positionals: ['test'], flags: { as: '@tester' }, restArgs: [] }, true, '/repo', { fingerprint: () => 'fp', ensure: () => {} });
  } finally {
    process.stdout.write = original;
  }
  assert.match(lines.join(''), /test queued as check #\d+ \(position 1\); keep working; faults will be posted to the board and you will be DMed\./);
});

test('team check: a second identical enqueue coalesces and does not start another worker', () => {
  const ctx = makeCtx();
  let ensured = 0;
  const deps = { ensure: () => { ensured += 1; } };
  const first = run(ctx, ['verify'], {}, deps);
  const second = run(ctx, ['verify'], { as: '@other' }, deps);
  assert.equal(second.action, 'coalesced');
  assert.equal(second.id, first.id);
  assert.equal(ensured, 1);
});

test('team check: status, list, show and cancel read and change the queue', () => {
  const ctx = makeCtx();
  const queued = run(ctx, ['build'], { task: 12 });
  assert.equal(run(ctx, ['status']).counts.queued, 1);
  assert.equal(run(ctx, ['list']).jobs.length, 1);
  assert.equal(run(ctx, ['show', String(queued.id)]).requesters[0].task_id, 12);
  assert.equal(run(ctx, ['cancel', String(queued.id)]).cancelled, queued.id);
  assert.equal(run(ctx, ['cancel', String(queued.id)]).refused, true);
  assert.equal(run(ctx, ['show', '999']).refused, true);
});

test('team check: an unknown or missing kind is refused with usage', () => {
  const ctx = makeCtx();
  assert.match(run(ctx, ['lint']).error, /Unknown check command "lint"/);
  assert.match(run(ctx, []).error, /Missing check kind/);
});

test('team check drain: runs the queued job with the injected executor and exits', async () => {
  const ctx = makeCtx();
  const queued = run(ctx, ['typecheck']);
  const delivered = [];
  const outcome = await run(ctx, ['drain'], {}, { executor: async () => ({ status: 'pass', durationMs: 1 }), deliver: (_db, job) => delivered.push(job.id), drainer: { sleep: async () => {}, fingerprint: () => 'fp', isAlive: () => true } }, ['--once']);
  assert.equal(outcome.exited, 'once');
  assert.deepEqual(delivered, [queued.id]);
});
