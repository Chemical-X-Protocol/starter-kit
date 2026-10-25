/**
 * `chemx run -- <command>` (#6758): runs the child with the caller's stdio, keeps the caller's file
 * leases alive every minute while it runs, and exits with the child's code. Temp projects only; the
 * renewal interval and the TTL are shortened so a "long" child takes about a second.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from '../team/team-db-locks.js';
import { createTask } from '../team/team-db-tasks.js';
import { registerAgent } from '../team/team-db-agents.js';
import { claimWithIgnoreDeps } from '../team/claim-ignore-deps.js';
import { RUN_RENEW_MS, parseRunArgs, runLeasedCommand } from './cmd-run.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const TTL = 400;

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const expiryOf = (db, file) => Number(db.prepare('SELECT expires_at FROM file_leases WHERE file_path = ?').get(file).expires_at);
const SLEEP_1500 = ['--', process.execPath, '-e', 'setTimeout(() => {}, 1500)'];

// Samples the lease while the child runs; true when it was ever expired.
const watchLapse = (db, file) => {
  const seen = { lapsed: false, expiries: new Set() };
  const timer = setInterval(() => {
    const expiry = expiryOf(db, file);
    seen.expiries.add(expiry);
    const isLapsed = expiry <= Date.now();
    if (isLapsed) seen.lapsed = true;
  }, 40);
  return { seen, stop: () => clearInterval(timer) };
};

test('the renewal interval is one minute', () => {
  assert.equal(RUN_RENEW_MS, 60000);
});

test('parseRunArgs: --as, then -- and the command words; the separator is optional', () => {
  assert.deepEqual(parseRunArgs(['--as=@x', '--', 'node', '-e', '1']), { as: '@x', words: ['node', '-e', '1'], error: null });
  assert.deepEqual(parseRunArgs(['--as', '@x', 'node', 'a.js', '--flag']), { as: '@x', words: ['node', 'a.js', '--flag'], error: null });
  assert.deepEqual(parseRunArgs(['--', 'node', '--as=@not-mine']), { as: undefined, words: ['node', '--as=@not-mine'], error: null });
});

test('parseRunArgs: no command, a missing --as value and a stray flag are usage errors', () => {
  assert.match(parseRunArgs(['--as=@x']).error, /no command/);
  assert.match(parseRunArgs([]).error, /no command/);
  assert.match(parseRunArgs(['--as']).error, /--as needs a handle/);
  assert.match(parseRunArgs(['--nope', 'node']).error, /unknown flag --nope.*after --/);
});

test('while the child runs the caller\'s lease is renewed, and it lapses again once the child is gone', async (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: TTL });
  const watch = watchLapse(db, 'src/a.js');

  const code = await runLeasedCommand(['--as=@spec-a', ...SLEEP_1500], { cwd: root, ttlMs: TTL, intervalMs: 100 });
  watch.stop();

  assert.equal(code, 0);
  assert.equal(watch.seen.lapsed, false, 'a 0.4 s lease survived a 1.5 s child');
  assert.ok(watch.seen.expiries.size > 3, `renewed repeatedly (${watch.seen.expiries.size} distinct expiries)`);
  assert.ok(expiryOf(db, 'src/a.js') > Date.now() - 50, 'renewed once more when the child ended');
  await sleep(TTL + 200);
  assert.ok(expiryOf(db, 'src/a.js') <= Date.now(), 'no timer outlives the command');
});

test('without a handle the child still runs, nothing is renewed, and one stderr line says why', async (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: TTL });
  const notes = [];

  const code = await runLeasedCommand(['--', process.execPath, '-e', 'setTimeout(() => {}, 700)'], { cwd: root, env: {}, ttlMs: TTL, intervalMs: 100, err: (text) => notes.push(text) });

  assert.equal(code, 0);
  assert.ok(expiryOf(db, 'src/a.js') <= Date.now(), 'the lease lapsed: nobody was named');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /no agent handle.*--as=@you or CHEMX_AGENT_ID.*no leases are renewed/);
});

test('from a worktree outside the board, the board of the caller\'s in_progress claim is renewed', async (t) => {
  const { root, db } = makeProject(t);
  const claims = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-run-claims-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-run-outside-'));
  t.after(() => fs.rmSync(claims, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const env = { ...process.env, CHEMX_BOARD_CLAIMS_DIR: claims };
  registerAgent(db, { id: '@spec-a', role: 'executor' });
  const task = createTask(db, { title: 'work' });
  claimWithIgnoreDeps(db, task.id, '@spec-a', undefined, { root, env });
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: TTL });
  const watch = watchLapse(db, 'src/a.js');

  await runLeasedCommand(['--as=@spec-a', ...SLEEP_1500], { cwd: outside, env, ttlMs: TTL, intervalMs: 100 });
  watch.stop();

  assert.equal(watch.seen.lapsed, false);
});

test('the exit code is the child\'s: 0, a failure code, a signal as 128 + n', async (t) => {
  const { root } = makeProject(t);
  const run = (script) => runLeasedCommand(['--as=@spec-a', '--', process.execPath, '-e', script], { cwd: root });

  assert.equal(await run('process.exit(0)'), 0);
  assert.equal(await run('process.exit(7)'), 7);
  assert.equal(await run("process.kill(process.pid, 'SIGTERM')"), 143);
});

test('a command that cannot start is 127 (not found) with the reason on stderr, 125 for a usage error', async (t) => {
  const { root } = makeProject(t);
  const notes = [];

  const missing = await runLeasedCommand(['--as=@spec-a', '--', 'chemx-no-such-binary-6758'], { cwd: root, err: (text) => notes.push(text) });
  const usage = await runLeasedCommand(['--as=@spec-a'], { cwd: root, err: (text) => notes.push(text) });

  assert.equal(missing, 127);
  assert.match(notes[0], /cannot start chemx-no-such-binary-6758/);
  assert.equal(usage, 125);
  assert.match(notes[1], /no command.*usage: chemx run/s);
});

test('CLI: stdout, stderr and the exit code of the child pass through untouched', (t) => {
  const { root } = makeProject(t);
  const env = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };
  const script = "console.log('out line'); console.error('err line'); process.exit(3)";

  const result = spawnSync(process.execPath, [CLI, 'run', '--', process.execPath, '-e', script], { cwd: root, env, encoding: 'utf8' });

  assert.equal(result.status, 3);
  assert.equal(result.stdout, 'out line\n');
  assert.equal(result.stderr, 'err line\n');
});

test('CLI: one quoted word is a whole shell command, and flags after the command belong to it', (t) => {
  const { root } = makeProject(t);
  const env = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };

  const shell = spawnSync(process.execPath, [CLI, 'run', '--', 'echo one && echo two'], { cwd: root, env, encoding: 'utf8' });
  const flags = spawnSync(process.execPath, [CLI, 'run', '--', process.execPath, '-e', 'console.log(process.argv.slice(1).join(","))', '--', '--help', '--json'], { cwd: root, env, encoding: 'utf8' });

  assert.equal(shell.stdout, 'one\ntwo\n');
  assert.equal(flags.stdout, '--help,--json\n');
});

test('CLI: SIGTERM to chemx reaches the child, which does not outlive it, and the exit code is 143', async (t) => {
  const { root } = makeProject(t);
  const env = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };
  const script = "console.log(process.pid); setInterval(() => {}, 1000)";
  const chemx = spawn(process.execPath, [CLI, 'run', '--', process.execPath, '-e', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  const firstLine = await new Promise((resolve) => chemx.stdout.once('data', (chunk) => resolve(String(chunk))));
  const childPid = Number(firstLine.trim());

  chemx.kill('SIGTERM');
  const code = await new Promise((resolve) => chemx.once('close', resolve));

  assert.equal(code, 143);
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, 'the child is gone');
});
