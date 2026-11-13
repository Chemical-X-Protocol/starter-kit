import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { handleCheckCommand } from './team-commands-check.js';
import { getCheck } from './check-queue.js';
import { AGENT_ID_ENV, SESSION_ID_ENVS } from './agent-identity.js';
import { ensureDrainer } from './check-drainer.js';

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

test('team check: a coalesced enqueue still checks for a live worker (ensureDrainer no-ops when one holds the lease)', () => {
  const ctx = makeCtx();
  let ensured = 0;
  const deps = { ensure: () => { ensured += 1; } };
  const first = run(ctx, ['verify'], {}, deps);
  const second = run(ctx, ['verify'], { as: '@other' }, deps);
  assert.equal(second.action, 'coalesced');
  assert.equal(second.id, first.id);
  assert.equal(ensured, 2);
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

test('team check: a joined job behind a dead worker revives the worker, and a cache hit starts nothing', () => {
  const ctx = makeCtx();
  const first = run(ctx, ['typecheck']);
  ctx.db.prepare("UPDATE check_jobs SET status = 'running', worker_token = 'dead' WHERE id = ?").run(first.id);
  const spawned = [];
  const ensure = (db, options) => ensureDrainer(db, { ...options, isAlive: () => false, spawnWorker: (cwd) => spawned.push(cwd) });
  const joined = run(ctx, ['typecheck'], { as: '@other' }, { ensure });
  assert.equal(joined.action, 'joined');
  assert.deepEqual(spawned, ['/repo']);
  ctx.db.prepare("UPDATE check_jobs SET status = 'done', finished_at = ?, result = ? WHERE id = ?").run(Date.now(), JSON.stringify({ status: 'pass' }), first.id);
  const cached = run(ctx, ['typecheck'], { as: '@third' }, { ensure });
  assert.equal(cached.action, 'cached');
  assert.equal(spawned.length, 1);
});

test('team check: a worker that could not be started is reported in the result and the message', () => {
  const ctx = makeCtx();
  const result = run(ctx, ['test'], {}, { ensure: () => ({ spawned: false, error: 'spawn ENOENT' }) });
  assert.equal(result.workerError, 'spawn ENOENT');
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    handleCheckCommand(ctx, { positionals: ['build'], flags: { as: '@tester' }, restArgs: [] }, true, '/repo', { fingerprint: () => 'fp', ensure: () => ({ spawned: false, error: 'spawn ENOENT' }) });
  } finally {
    process.stdout.write = original;
  }
  assert.match(lines.join(''), /WARNING: the drain worker could not be started \(spawn ENOENT\)/);
});

const withoutIdentityEnv = (action) => {
  const names = [AGENT_ID_ENV, ...SESSION_ID_ENVS];
  const saved = names.map((name) => [name, process.env[name]]);
  for (const name of names) delete process.env[name];
  try {
    return action();
  } finally {
    for (const [name, value] of saved) {
      const wasSet = value !== undefined;
      if (wasSet) process.env[name] = value;
    }
  }
};

test('team check: a requester with no stable identity is refused and nothing is queued', () => {
  const ctx = makeCtx();
  const result = withoutIdentityEnv(() => handleCheckCommand(ctx, { positionals: ['typecheck'], flags: {}, restArgs: [] }, false, '/repo', { fingerprint: () => 'fp', ensure: () => assert.fail('no worker for a refused request') }));
  assert.equal(result.refused, true);
  assert.match(result.error, /Pass --as=<@handle> or set CHEMX_AGENT_ID/);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM check_jobs').get().n, 0);
});

test('team check cancel: it DMs the other requesters, not the canceller, and says who cancelled', () => {
  const ctx = makeCtx();
  const first = run(ctx, ['typecheck']);
  run(ctx, ['typecheck'], { as: '@other' });
  const cancelled = run(ctx, ['cancel', String(first.id)], { as: '@tester' });
  assert.equal(cancelled.notified, 1);
  const dms = ctx.db.prepare("SELECT recipient_id, message FROM agent_feed WHERE event_type = 'dm'").all();
  assert.deepEqual(dms.map((dm) => dm.recipient_id), ['@other']);
  assert.match(dms[0].message, /CANCELLED by @tester/);
});

test('team check cancel: a DM that fails is reported, never thrown, and stays un-notified for the worker to retry', () => {
  const ctx = makeCtx();
  const first = run(ctx, ['test']);
  run(ctx, ['test'], { as: '@other' });
  const cancelled = run(ctx, ['cancel', String(first.id)], { as: '@tester' }, { deliver: () => { throw new Error('dm down'); } });
  assert.equal(cancelled.notified, 0);
  assert.deepEqual(cancelled.notifyErrors, ['dm down']);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM check_requesters WHERE job_id = ? AND notified_at IS NULL').get(first.id).n, 1);
});
