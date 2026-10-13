import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runHeavy } from './job-line.js';
import { currentLine } from './job-line-tickets.js';
import { FAST, deadPid, named, readSlot, readTicketFile, writeJson, lineFiles, options, heldRun, until, withDir, joinToken, liveRecord } from './job-line-spec-helpers.js';

const exists = (dir, name) => fs.existsSync(path.join(dir, name));

test('job-line takeover: the joiner of an owner that died takes the ticket over and runs it', withDir(async (dir) => {
  writeJson(dir, 'ticket-1', liveRecord({ seq: 1, token: 'ghost', key: 'k', state: 'waiting', handle: '@ghost' }));
  writeJson(dir, 'seq', 1);
  const job = heldRun('ran');
  const joiner = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  const token = joinToken(dir, 1);
  writeJson(dir, 'ticket-1', { ...readTicketFile(dir, 1), pid: deadPid() });
  await job.started;
  assert.equal(readTicketFile(dir, 1).token, token, 'same seq, taken over by the joiner');
  job.finish();
  const outcome = await joiner;
  assert.equal(outcome.result, 'ran');
  assert.deepEqual(job.calls, [4]);
  assert.equal(outcome.shared, null, 'nobody else joined');
  assert.deepEqual(lineFiles(dir), []);
}));

test('job-line takeover: a running owner whose ticket was swept or went stale puts it back', withDir(async (dir) => {
  const job = heldRun('a');
  const owner = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, job.run);
  const waiting = heldRun('b');
  const next = runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, waiting.run);
  await job.started;
  const { token, startedAt } = readTicketFile(dir, 1);
  fs.rmSync(path.join(dir, 'ticket-1'));
  await until(() => exists(dir, 'ticket-1'), 'the owner to put its ticket back');
  assert.deepEqual([readTicketFile(dir, 1).token, readTicketFile(dir, 1).state, readTicketFile(dir, 1).startedAt], [token, 'running', startedAt]);
  writeJson(dir, 'ticket-1', { ...readTicketFile(dir, 1), heartbeat: 0 });
  await until(() => exists(dir, 'ticket-1') && readTicketFile(dir, 1).heartbeat > 0, 'a stale running ticket to be live again');
  assert.equal(readTicketFile(dir, 1).token, token);
  assert.equal(readTicketFile(dir, 2).state, 'waiting', 'the next job never started beside it');
  assert.deepEqual(waiting.calls, []);
  job.finish();
  waiting.finish();
  await Promise.all([owner, next]);
}));

test('job-line takeover: a running owner leaves a slot another run took and says so once', withDir(async (dir) => {
  const warnings = [];
  const job = heldRun('a');
  const owner = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { onWarn: (line) => warnings.push(line) }) }, job.run);
  await job.started;
  const other = liveRecord({ token: 'other', seq: 9, handle: '@other' });
  writeJson(dir, 'slot-0', other);
  await until(() => warnings.length > 0, 'the overlap warning');
  const beats = readSlot(dir, 1).heartbeat;
  await until(() => readSlot(dir, 1).heartbeat > beats + FAST.heartbeatMs, 'two more heartbeats');
  assert.equal(warnings.length, 1, 'one warning per job');
  assert.ok(warnings[0].startsWith(`chemx: this tests run stalled past the stale window (${FAST.staleMs}ms) and another run took its heavy slots`), warnings[0]);
  assert.equal(readSlot(dir, 0).token, 'other', 'the slot is left to the run that holds it');
  job.finish();
  await owner;
  assert.equal(readSlot(dir, 0).token, 'other', 'and is not removed by the owner on release');
}));

test('job-line takeover: a stalled owner whose seq was taken over writes no result; the newcomer runs its own', withDir(async (dir) => {
  const warnings = [];
  const stalled = heldRun('stale');
  const owner = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { handle: '@stalled', onWarn: (line) => warnings.push(line) }) }, stalled.run);
  await stalled.started;
  writeJson(dir, 'ticket-1', liveRecord({ seq: 1, token: 'takeover', key: 'k', state: 'waiting', handle: '@takeover' }));
  const fresh = heldRun('fresh');
  const newcomer = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { handle: '@new' }) }, fresh.run);
  assert.equal(named(dir, 'join-1-').length, 1, 'the newcomer joined the takeover\'s waiting ticket');
  await until(() => warnings.length > 0, 'the stalled owner to notice its ticket was taken');
  assert.match(warnings[0], /another run took its line ticket/);
  stalled.finish();
  const late = await owner;
  assert.equal(late.shared, null);
  assert.equal(exists(dir, 'result-1'), false, 'the stalled owner handed nothing to the takeover\'s joiner');
  fs.rmSync(path.join(dir, 'ticket-1'));
  await fresh.started;
  fresh.finish();
  assert.equal((await newcomer).result, 'fresh');
  assert.deepEqual(fresh.calls, [4]);
}));

test('job-line takeover: a joiner never takes the result of a run that started before it joined', withDir(async (dir) => {
  writeJson(dir, 'ticket-1', liveRecord({ seq: 1, token: 'takeover', key: 'k', state: 'waiting', handle: '@takeover' }));
  writeJson(dir, 'seq', 1);
  const result = { seq: 1, joined: 1, workers: 4, writtenAt: Date.now() };
  writeJson(dir, 'result-1', { ...result, owner: '@stalled', startedAt: Date.now() - 1000, result: 'stale' });
  const newcomer = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, async () => assert.fail('the takeover runs it'));
  assert.equal(named(dir, 'join-1-').length, 1, 'still waiting: the stale result was not taken');
  writeJson(dir, 'result-1', { ...result, owner: '@takeover', startedAt: Date.now(), result: 'fresh' });
  fs.rmSync(path.join(dir, 'ticket-1'));
  const outcome = await newcomer;
  assert.equal(outcome.result, 'fresh');
  assert.deepEqual(outcome.shared, { owner: '@takeover', joined: 1, seq: 1 });
}));

test('job-line takeover: a result nobody is left to read goes after the stale window; one with a reader stays', withDir(async (dir) => {
  const now = Date.now();
  const old = now - FAST.staleMs * 2;
  writeJson(dir, 'result-5', { seq: 5, writtenAt: old, result: 'abandoned' });
  writeJson(dir, 'result-6', { seq: 6, writtenAt: now, result: 'young' });
  writeJson(dir, 'result-7', { seq: 7, writtenAt: old, result: 'awaited' });
  writeJson(dir, `join-7-${process.pid}-reader`, liveRecord({ seq: 7, token: 'reader' }));
  currentLine(dir, now, FAST.staleMs);
  assert.deepEqual(named(dir, 'result-'), ['result-6', 'result-7']);
}));

for (const leave of ['returnQueuedAfterMs', 'abort']) {
  test(`job-line takeover: an owner that leaves the line (${leave}) hands its place to its joiner`, withDir(async (dir) => {
    const blocker = heldRun('a');
    const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, blocker.run);
    await blocker.started;
    const controller = new AbortController();
    const leaving = leave === 'abort' ? { signal: controller.signal } : { returnQueuedAfterMs: 30 };
    const owner = runHeavy({ kind: 'build', key: 'k:b', ...options(dir, leaving) }, async () => assert.fail('the owner left'));
    const joined = heldRun('j');
    const joiner = runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, joined.run);
    const token = joinToken(dir, 2);
    controller.abort();
    if (leave === 'abort') await assert.rejects(owner, /cancelled while waiting in line/);
    else assert.equal((await owner).queued, true);
    await until(() => exists(dir, 'ticket-2') && readTicketFile(dir, 2).token === token, 'the joiner to take #2 over');
    assert.equal(readTicketFile(dir, 2).state, 'waiting', 'it keeps #2 behind the running job');
    blocker.finish();
    await joined.started;
    joined.finish();
    const [, outcome] = await Promise.all([first, joiner]);
    assert.equal(outcome.result, 'j');
    assert.deepEqual(joined.calls, [4]);
  }));
}

// A hand-written live join of #1 with no ticket: its owner is gone and the joiner has yet to take over.
const pendingTakeover = (dir, key) => {
  writeJson(dir, `join-1-${process.pid}-pending`, liveRecord({ seq: 1, token: 'pending', since: Date.now() - 1000, key, handle: '@pending' }));
  writeJson(dir, 'seq', 1);
};

test('job-line takeover: a seq awaiting its takeover keeps its place against a later ticket', withDir(async (dir) => {
  pendingTakeover(dir, 'k1');
  const lines = [];
  const later = heldRun('later');
  const running = runHeavy({ kind: 'build', key: 'k2', ...options(dir, { onWait: (line) => lines.push(line) }) }, later.run);
  assert.equal(readTicketFile(dir, 2).state, 'waiting', 'the later ticket did not start ahead of #1');
  assert.match(lines[0], /in line #2 for build .*ahead: tests/);
  fs.rmSync(path.join(dir, `join-1-${process.pid}-pending`));
  await later.started;
  later.finish();
  assert.equal((await running).result, 'later');
}));

test('job-line takeover: a newcomer joins a seq awaiting its takeover, and takes it over when that joiner goes', withDir(async (dir) => {
  pendingTakeover(dir, 'k');
  const job = heldRun('mine');
  const newcomer = runHeavy({ kind: 'tests', key: 'k', ...options(dir) }, job.run);
  assert.deepEqual(named(dir, 'ticket-'), [], 'it took no ticket of its own');
  assert.equal(named(dir, 'join-1-').length, 2, 'it joined #1');
  fs.rmSync(path.join(dir, `join-1-${process.pid}-pending`));
  const token = joinToken(dir, 1);
  await job.started;
  assert.equal(readTicketFile(dir, 1).token, token, 'the newcomer took #1 over');
  job.finish();
  const outcome = await newcomer;
  assert.equal(outcome.result, 'mine');
  assert.equal(outcome.shared, null);
}));

test('job-line takeover: a waiting owner whose ticket was swept puts it back, or joins the run that took its seq', withDir(async (dir) => {
  const blocker = heldRun('a');
  const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, blocker.run);
  await blocker.started;
  const job = heldRun('b');
  const owner = runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, job.run);
  const { token } = readTicketFile(dir, 2);
  fs.rmSync(path.join(dir, 'ticket-2'));
  await until(() => exists(dir, 'ticket-2'), 'the waiting owner to put its ticket back');
  assert.deepEqual([readTicketFile(dir, 2).token, readTicketFile(dir, 2).state], [token, 'waiting']);
  writeJson(dir, 'ticket-2', liveRecord({ seq: 2, token: 'takeover', key: 'k:b', state: 'waiting' }));
  await until(() => named(dir, 'join-2-').length === 1, 'the owner to join the run that took its seq');
  assert.equal(joinToken(dir, 2), token);
  fs.rmSync(path.join(dir, 'ticket-2'));
  await until(() => exists(dir, 'ticket-2') && readTicketFile(dir, 2).token === token, 'it to take #2 back as the oldest joiner');
  blocker.finish();
  await job.started;
  job.finish();
  const [, outcome] = await Promise.all([first, owner]);
  assert.equal(outcome.result, 'b');
  assert.deepEqual(job.calls, [4]);
}));

test('job-line takeover: a run that throws hands the ticket to its joiner, who runs it', withDir(async (dir) => {
  const blocker = heldRun('a');
  const first = runHeavy({ kind: 'tests', key: 'k:a', ...options(dir) }, blocker.run);
  await blocker.started;
  const owner = runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, async () => { throw new Error('boom'); });
  const joined = heldRun('j');
  const joiner = runHeavy({ kind: 'build', key: 'k:b', ...options(dir) }, joined.run);
  const token = joinToken(dir, 2);
  blocker.finish();
  await assert.rejects(owner, /boom/);
  await joined.started;
  assert.equal(readTicketFile(dir, 2).token, token, 'the joiner took #2 over');
  joined.finish();
  const [, outcome] = await Promise.all([first, joiner]);
  assert.equal(outcome.result, 'j');
  assert.deepEqual(joined.calls, [4]);
  assert.deepEqual(lineFiles(dir), [], 'no result was left for anyone');
}));

test('job-line takeover: a running owner whose slot dir was removed (rm -rf to unstick) still returns its result', withDir(async (dir) => {
  const warnings = [];
  const job = heldRun('done');
  const owner = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { onWarn: (line) => warnings.push(line) }) }, job.run);
  await job.started;
  fs.rmSync(dir, { recursive: true, force: true });
  job.finish();
  const outcome = await owner;
  assert.equal(outcome.result, 'done');
  assert.deepEqual(warnings, []);
  assert.deepEqual(lineFiles(dir), [], 'the dir was made again and left clean');
}));

test('job-line takeover: bookkeeping that fails after the run never costs the run its outcome', withDir(async (dir) => {
  const warnings = [];
  const job = heldRun('done');
  const owner = runHeavy({ kind: 'tests', key: 'k', ...options(dir, { heartbeatMs: 60000, onWarn: (line) => warnings.push(line) }) }, job.run);
  await job.started;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(dir, 'a file where the slot dir was');
  job.finish();
  const outcome = await owner;
  assert.equal(outcome.result, 'done');
  assert.equal(outcome.shared, null);
  assert.match(warnings.join(''), /could not hand the result to its joiners \(ENOTDIR/);
  assert.match(warnings.join(''), /could not leave the line/);
}));
