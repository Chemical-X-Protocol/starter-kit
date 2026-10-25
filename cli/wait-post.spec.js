/**
 * chemx wait --post-matching <text> [--from=@handle] [--since=<event id>] (K14, #6759): resolves when a feed
 * post matches. Temp db only; injected clock and sleep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openIndexDb } from './search-schema.js';
import { postFeedEvent } from './team/team-db-feed.js';
import { runWait, parseWaitArgs } from './wait-command.js';

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');

const makeBoard = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wait-post-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openIndexDb(root, { fresh: true });
  t.after(() => db.close());
  return { root, db };
};

const post = (db, author, message, type = 'broadcast') => postFeedEvent(db, { author_id: author, event_type: type, message });

const fakeTime = () => {
  let now = 0;
  return { clock: () => now, sleep: async (ms) => { now += ms; } };
};

// A sleep that runs steps[0] on the first poll, steps[1] on the second, and so on, then advances the fake clock.
const scripted = (time, steps) => {
  let polls = 0;
  return async (ms) => {
    steps[polls]?.();
    polls += 1;
    await time.sleep(ms);
  };
};

test('parseWaitArgs: --post-matching takes its text after a space or an equals sign, with --from and --since', () => {
  const spaced = parseWaitArgs(['--post-matching', 'K9 merged', '--from', '@sonnet-k9', '--since', '12', '--timeout', '5m']);
  assert.equal(spaced.error, null);
  assert.deepEqual([spaced.postMatching, spaced.from, spaced.since, spaced.timeoutMs], ['K9 merged', '@sonnet-k9', 12, 300000]);
  const equals = parseWaitArgs(['--post-matching=merged', '--from=sonnet-k9']);
  assert.deepEqual([equals.postMatching, equals.from, equals.since], ['merged', '@sonnet-k9', null], 'a handle without @ gets one');
});

test('parseWaitArgs: --post-matching is its own condition; --from and --since need it; text and numbers are checked', () => {
  const bad = [
    ['--post-matching', 'x', '--verify-idle'], ['--post-matching', 'x', '--task=1'], ['--post-matching'], ['--post-matching='],
    ['--from=@a', '--verify-idle'], ['--since=3', '--task=1'], ['--post-matching=x', '--since=soon'], ['--post-matching=x', '--since=-4']
  ];
  for (const args of bad) assert.notEqual(parseWaitArgs(args).error, null, args.join(' '));
});

test('wait --post-matching resolves on the first matching post made after the wait began', async (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'K9 merged earlier, before the wait');
  const time = fakeTime();
  const sleep = scripted(time, [() => post(db, '@b', 'something unrelated'), () => post(db, '@c', 'PR is up; k9 MERGED at abc123', 'status_update')]);
  const result = await runWait(['--post-matching', 'k9 merged', '--timeout=10m'], { cwd: root, clock: time.clock, sleep });
  assert.equal(result.code, 0, result.message);
  assert.match(result.message, /condition met after 6\.0s: post #3 by @c \[status_update\] matches "k9 merged": PR is up; k9 MERGED at abc123/);
});

test('wait --post-matching --from only counts posts of that handle, and lock events never match', async (t) => {
  const { root, db } = makeBoard(t);
  const time = fakeTime();
  const sleep = scripted(time, [
    () => post(db, '@other', 'merged by someone else'),
    () => post(db, '@sonnet-k9', 'locked merged.js', 'lock_acquired'),
    () => post(db, '@sonnet-k9', 'K9 merged')
  ]);
  const result = await runWait(['--post-matching=merged', '--from=@sonnet-k9'], { cwd: root, clock: time.clock, sleep });
  assert.equal(result.code, 0, result.message);
  assert.match(result.message, /post #3 by @sonnet-k9 \[broadcast\]/);
});

test('wait --post-matching --since=<id> also sees posts that already exist', async (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'first');
  post(db, '@a', 'K9 merged');
  const time = fakeTime();
  const found = await runWait(['--post-matching=k9 merged', '--since=1'], { cwd: root, clock: time.clock, sleep: time.sleep });
  assert.equal(found.code, 0);
  assert.match(found.message, /post #2 by @a/);
  const missed = await runWait(['--post-matching=k9 merged', '--since=2', '--timeout=6s'], { cwd: root, clock: time.clock, sleep: time.sleep });
  assert.equal(missed.code, 2);
  assert.match(missed.message, /timed out after .*no post matching "k9 merged" after event #2/);
});

test('wait --post-matching times out with exit 2 when nothing matches, naming the handle filter', async (t) => {
  const { root, db } = makeBoard(t);
  const time = fakeTime();
  const sleep = async (ms) => {
    post(db, '@x', 'merged');
    await time.sleep(ms);
  };
  const result = await runWait(['--post-matching=merged', '--from=@nobody', '--timeout=6s'], { cwd: root, clock: time.clock, sleep });
  assert.equal(result.code, 2);
  assert.match(result.message, /no post matching "merged" from @nobody after event #0/);
});

test('the real CLI: wait --post-matching exits 0 on a match, 2 on timeout and 1 on a bad combination', (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'K9 merged');
  const run = (args) => spawnSync(process.execPath, [CLI, 'wait', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', NO_COLOR: '1' } });
  const met = run(['--post-matching', 'k9 merged', '--since', '0', '--timeout=1s']);
  assert.equal(met.status, 0, met.stdout + met.stderr);
  assert.match(met.stdout, /post #1 by @a/);
  assert.equal(run(['--post-matching=nothing', '--timeout=1s']).status, 2);
  assert.equal(run(['--post-matching=x', '--verify-idle']).status, 1);
});
