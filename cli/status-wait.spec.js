/**
 * chemx status and chemx wait (#2565). Temp git repo and temp db only; injected clock and sleep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openIndexDb } from './search-schema.js';
import { runStatus, parsePorcelain } from './status-command.js';
import { runWait, parseDuration, verifyProcesses } from './wait-command.js';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const makeRepo = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-status-wait-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '.chemx/\n');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, 'a.js'), 'a\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'b\n');
  fs.writeFileSync(path.join(root, 'c.js'), 'c\n');
  const db = openIndexDb(root, { fresh: true });
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  t.after(() => db.close());
  return { root, db };
};

const lease = (db, file, holder, purpose, expiresAt = Date.now() + 5 * 60000) => {
  db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)').run(file, holder, Date.now(), expiresAt, purpose);
};

test('parsePorcelain reads codes, paths and rename targets', () => {
  const rows = parsePorcelain(' M a.js\n?? new.js\nR  old.js -> moved.js\n');
  assert.deepEqual(rows, [{ code: ' M', file: 'a.js' }, { code: '??', file: 'new.js' }, { code: 'R ', file: 'moved.js' }]);
});

test('status annotates leases and flags unleased and other-held files', (t) => {
  const { root, db } = makeRepo(t);
  for (const file of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(root, file), 'changed\n');
  lease(db, 'a.js', '@me', '#2565');
  lease(db, 'b.js', '@peer', '#7 refactor');
  const result = runStatus(['--as=@me'], false, root);
  const byFile = Object.fromEntries(result.rows.map((row) => [row.file, row]));
  assert.equal(byFile['a.js'].state, 'yours');
  assert.equal(byFile['a.js'].task, 2565);
  assert.equal(byFile['a.js'].flagged, false);
  assert.equal(byFile['b.js'].state, 'other');
  assert.equal(byFile['b.js'].holder, '@peer');
  assert.equal(byFile['b.js'].task, 7);
  assert.equal(byFile['b.js'].flagged, true);
  assert.equal(byFile['c.js'].state, 'unleased');
  assert.equal(byFile['c.js'].flagged, true);
  assert.equal(result.summary, '3 changed, 1 leased by you, 1 leased by another, 0 leased (handle unknown), 1 unleased');
});

test('status ignores an expired lease and reports a clean tree as zero', (t) => {
  const { root, db } = makeRepo(t);
  assert.equal(runStatus([], false, root).rows.length, 0);
  fs.writeFileSync(path.join(root, 'a.js'), 'changed\n');
  lease(db, 'a.js', '@peer', '#1', Date.now() - 60000);
  const result = runStatus(['--as=@me'], false, root);
  assert.equal(result.rows[0].state, 'unleased');
});

test('status outside a git repo exits 1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-status-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(runStatus([], false, dir).code, 1);
});

test('parseDuration accepts s, m, h and bare seconds', () => {
  assert.equal(parseDuration('30s'), 30000);
  assert.equal(parseDuration('5m'), 300000);
  assert.equal(parseDuration('2h'), 7200000);
  assert.equal(parseDuration('90'), 90000);
  assert.equal(parseDuration('soon'), null);
});

// A fake clock: each sleep advances time by the requested amount.
const fakeTime = () => {
  let now = 0;
  return { clock: () => now, sleep: async (ms) => { now += ms; } };
};

test('wait --task returns 0 once the task reaches the status', async (t) => {
  const { root, db } = makeRepo(t);
  db.prepare("INSERT INTO agent_tasks (id, title, status, created_at, updated_at) VALUES (900, 't', 'in_progress', 1, 1)").run();
  const time = fakeTime();
  let polls = 0;
  const sleep = async (ms) => {
    polls += 1;
    const isSecond = polls === 2;
    if (isSecond) db.prepare("UPDATE agent_tasks SET status = 'done' WHERE id = 900").run();
    await time.sleep(ms);
  };
  const result = await runWait(['--task=900', '--timeout=10m'], { cwd: root, clock: time.clock, sleep });
  assert.equal(result.code, 0);
  assert.match(result.message, /condition met after 6\.0s: task #900 is done/);
});

test('wait --task times out with exit 2 and names an unknown task', async (t) => {
  const { root } = makeRepo(t);
  const time = fakeTime();
  const result = await runWait(['--task=999', '--timeout=10s'], { cwd: root, clock: time.clock, sleep: time.sleep });
  assert.equal(result.code, 2);
  assert.match(result.message, /timed out after .*task #999 is unknown to any db/);
});

test('wait --lock-free waits for the lease to be released', async (t) => {
  const { root, db } = makeRepo(t);
  lease(db, 'a.js', '@peer', '#1');
  const time = fakeTime();
  const sleep = async (ms) => {
    db.prepare('DELETE FROM file_leases WHERE file_path = ?').run('a.js');
    await time.sleep(ms);
  };
  const result = await runWait(['--lock-free=a.js'], { cwd: root, clock: time.clock, sleep });
  assert.equal(result.code, 0);
  assert.match(result.message, /a\.js has no live lease/);
});

test('wait --lock-free times out while the lease is held', async (t) => {
  const { root, db } = makeRepo(t);
  lease(db, 'a.js', '@peer', '#1', Date.now() + 3600000);
  const time = fakeTime();
  const result = await runWait(['--lock-free=a.js', '--timeout=9s'], { cwd: root, clock: time.clock, sleep: time.sleep });
  assert.equal(result.code, 2);
  assert.match(result.message, /a\.js held by @peer/);
});

test('verifyProcesses counts only chemx verify/test commands inside the project', () => {
  const ps = ['  11 node /x/cli/index.js verify', '  12 chemx test cli/a.spec.js', '  13 node other.js', '  14 chemx verify'].join('\n');
  const cwdOf = (pid) => (pid === 14 ? '/elsewhere' : '/proj/sub');
  const found = verifyProcesses(ps, '/proj', 999, cwdOf).map((proc) => proc.pid);
  assert.deepEqual(found, [11, 12]);
});

test('wait --verify-idle follows the injected process table', async (t) => {
  const { root } = makeRepo(t);
  const time = fakeTime();
  const idle = await runWait(['--verify-idle'], { cwd: root, clock: time.clock, sleep: time.sleep, env: { ps: '  5 node x.js' } });
  assert.equal(idle.code, 0);
  const busy = await runWait(['--verify-idle', '--timeout=6s'], { cwd: root, clock: time.clock, sleep: time.sleep, env: { ps: `  5 chemx verify` } });
  assert.equal(busy.code, 2, 'a verify process with an unreadable cwd is counted, so the wait times out');
});

test('wait rejects missing, doubled and malformed arguments with exit 1', async () => {
  for (const args of [[], ['--task=1', '--verify-idle'], ['--task=abc'], ['--verify-idle', '--timeout=soon']]) {
    assert.equal((await runWait(args)).code, 1, args.join(' '));
  }
});

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'index.js');

const runCli = (cwd, args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', NO_COLOR: '1' } });

test('the real CLI answers status and wait with exit codes 0, 1 and 2', (t) => {
  const { root } = makeRepo(t);
  fs.writeFileSync(path.join(root, 'a.js'), 'changed\n');
  const status = runCli(root, ['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /a\.js/);
  const met = runCli(root, ['wait', '--lock-free=a.js', '--timeout=1s']);
  assert.equal(met.status, 0, met.stdout + met.stderr);
  const bad = runCli(root, ['wait', '--bogus']);
  assert.equal(bad.status, 1);
  const late = runCli(root, ['wait', '--task=999999', '--timeout=1s']);
  assert.equal(late.status, 2, late.stdout + late.stderr);
});
