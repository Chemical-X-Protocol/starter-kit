/**
 * #6747: `chemx team lock` takes several paths per call and answers with one line per path
 * (granted until HH:MM | queued behind @x | refused: reason), the renewal note once at the end.
 * An absolute path inside the board's root is accepted from any directory under it (a sibling repo,
 * a submodule), the lease is keyed from the board root, and a path outside the root is still refused.
 * Temp dirs only (fs.mkdtemp); CHEMX_PROJECT_ROOT is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, cleanExpiredLeases } from './team-db-locks.js';
import { handleLockCommand, handleUnlockCommand } from './team-commands-lock.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { buildMonorepo } from './coordination-fixture.js';

delete process.env.CHEMX_PROJECT_ROOT;

const ANSI = /\x1b\[[0-9;]*m/g;

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-multi-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(root, name), '');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const withMonorepo = (t) => {
  const repo = buildMonorepo('chemx-lock-xrepo-');
  t.after(() => repo.cleanup());
  return repo;
};

// Runs fn with stdout and stderr captured; the exit code it sets is read, then restored.
const capture = (fn) => {
  const out = [];
  const err = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  const priorExit = process.exitCode;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  process.exitCode = undefined;
  try {
    const result = fn();
    return { result, out: out.join('').replace(ANSI, ''), err: err.join('').replace(ANSI, ''), exit: process.exitCode };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
    process.exitCode = priorExit;
  }
};

const lockCli = (db, root, positionals, flags = {}) => capture(() => handleLockCommand(db, positionals, { as: '@spec-a', ...flags }, true, root));
const leaseCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM file_leases').get().n;
const leaseKeys = (repo) => openTeamContext(repo.root).db.prepare('SELECT file_path, locked_by FROM file_leases ORDER BY file_path').all().map((row) => ({ ...row }));
const linesOf = (text) => text.trimEnd().split('\n');

test('three paths in one call lease all three: one line each, the renewal note once', (t) => {
  const { root, db } = makeProject(t);
  const run = lockCli(db, root, ['a.js', 'b.js', 'c.js']);
  assert.equal(leaseCount(db), 3);
  const lines = linesOf(run.out);
  assert.equal(lines.length, 4, run.out);
  ['a', 'b', 'c'].forEach((name, i) => assert.match(lines[i], new RegExp(`^✔ ${name}\\.js granted until \\d\\d:\\d\\d$`)));
  assert.match(lines[3], /^Any chemx command run as this handle extends it to 5 minutes from then/);
  assert.equal(run.err, '');
  assert.equal(run.exit, undefined, 'a clean grant sets no failing exit code');
  assert.deepEqual(run.result.summary, { granted: 3, queued: 0, refused: 0 });
  assert.equal(run.result.results.length, 3);
});

test('mixed call: granted, queued behind the holder and refused each get a line on stdout', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'b.js', '@spec-holder', { cwd: root });
  const run = lockCli(db, root, ['a.js', 'b.js', 'nope.js']);
  const lines = linesOf(run.out);
  assert.equal(lines.length, 4, run.out);
  assert.match(lines[0], /^✔ a\.js granted until \d\d:\d\d$/);
  assert.match(lines[1], /^⏳ b\.js queued behind @spec-holder \(position 1, holder notified\)$/);
  assert.match(lines[2], /^✕ nope\.js refused: .*does not exist/);
  assert.match(lines[3], /^Any chemx command/);
  assert.equal(run.err, '', 'every path line is on stdout');
  assert.equal(run.exit, 1, 'a refused path sets exit 1; a queued one does not');
  assert.deepEqual(run.result.summary, { granted: 1, queued: 1, refused: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM file_lock_queue').get().n, 1);
});

test('a repeat poll says still queued and that the holder was already told', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'b.js', '@spec-holder', { cwd: root });
  lockCli(db, root, ['b.js']);
  const run = lockCli(db, root, ['b.js']);
  assert.match(run.out, /^⏳ b\.js still queued behind @spec-holder \(position 1, holder already notified\)\n$/);
});

test('when nothing is granted there is no renewal note, and a single queued path is one line', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'b.js', '@spec-holder', { cwd: root });
  const run = lockCli(db, root, ['b.js']);
  assert.equal(linesOf(run.out).length, 1, run.out);
  assert.doesNotMatch(run.out, /Any chemx command/);
  assert.equal(run.result.queued, true, 'a single path keeps the plain result shape');
});

test('a single granted path is one line plus the note, and keeps the plain result shape', (t) => {
  const { root, db } = makeProject(t);
  const run = lockCli(db, root, ['a.js']);
  assert.equal(linesOf(run.out).length, 2, run.out);
  assert.equal(run.result.granted, true);
  assert.equal(run.result.lease.file_path, 'a.js');
});

test('an earlier lapse is mentioned on the granted line', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'a.js', '@spec-a', { cwd: root });
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - 120000, 'a.js');
  cleanExpiredLeases(db);
  const run = lockCli(db, root, ['a.js']);
  assert.match(run.out, /^✔ a\.js granted until \d\d:\d\d \(your earlier lease expired \d\d:\d\d:\d\d\)\n/);
});

test('--json with several paths prints one object with a result per path', (t) => {
  const { root, db } = makeProject(t);
  const run = lockCli(db, root, ['a.js', 'b.js'], { isJson: true });
  const parsed = JSON.parse(run.out);
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].file, 'a.js');
  assert.equal(parsed.results[0].granted, true);
  assert.deepEqual(parsed.summary, { granted: 2, queued: 0, refused: 0 });
});

test('release takes several paths too, one line each', (t) => {
  const { root, db } = makeProject(t);
  lockCli(db, root, ['a.js', 'b.js', 'c.js']);
  const run = capture(() => handleLockCommand(db, ['release', 'a.js', 'b.js'], { as: '@spec-a' }, true, root));
  assert.equal(linesOf(run.out).length, 2, run.out);
  assert.match(run.out, /Released lock on a\.js/);
  assert.match(run.out, /Released lock on b\.js/);
  assert.equal(leaseCount(db), 1);
  const unlock = capture(() => handleUnlockCommand(db, ['c.js', 'a.js'], { as: '@spec-a' }, true, root));
  assert.match(unlock.out, /Released lock on c\.js/);
  assert.match(unlock.err, /Unlock failed \(a\.js\): /);
  assert.equal(leaseCount(db), 0);
});

test('check, status and renew take one path: extra paths are refused, not ignored', (t) => {
  const { root, db } = makeProject(t);
  ['check', 'status', 'renew'].forEach((action) => {
    const run = capture(() => handleLockCommand(db, [action, 'a.js', 'b.js'], { as: '@spec-a' }, true, root));
    assert.equal(run.result.error, 'one_path_only', action);
    assert.match(run.err, new RegExp(`lock ${action} takes one path`));
    assert.equal(run.exit, 1, action);
  });
});

test('the CLI line for a sibling-repo path names the path as typed, with the usual grant wording', (t) => {
  const repo = withMonorepo(t);
  const sibling = path.join(repo.pkgB, 'src', 'y.js');
  const run = capture(() => runTeamCli(['lock', sibling, path.join(repo.pkgA, 'src', 'x.js'), '--as=@spec-a'], true, repo.pkgA));
  const lines = linesOf(run.out);
  assert.equal(lines[0], `✔ ${sibling} granted until ${lines[0].slice(-5)}`);
  assert.match(lines[1], /^✔ .*x\.js granted until \d\d:\d\d$/);
});

test('a path outside the board root is one refused line and exit 1, nothing leased', (t) => {
  const repo = withMonorepo(t);
  const run = capture(() => runTeamCli(['lock', '/etc/passwd', '--as=@spec-a'], true, repo.pkgA));
  assert.match(run.out, /^✕ \/etc\/passwd refused: outside the board root /);
  assert.equal(run.exit, 1);
  assert.deepEqual(leaseKeys(repo), []);
});

test('release, check and status accept the sibling-repo absolute path too', (t) => {
  const repo = withMonorepo(t);
  const sibling = path.join(repo.pkgB, 'src', 'y.js');
  runTeamCli(['lock', 'acquire', sibling, '--as=@spec-a'], false, repo.pkgA);
  const checked = runTeamCli(['lock', 'check', sibling, '--as=@spec-b'], false, repo.pkgA);
  assert.equal(checked.clear, false);
  assert.equal(checked.locked_by, '@spec-a');
  const status = runTeamCli(['lock', 'status', sibling, '--as=@spec-b'], false, repo.pkgA);
  assert.equal(status.lease.locked_by, '@spec-a');
  const released = runTeamCli(['unlock', sibling, '--as=@spec-a'], false, repo.pkgA);
  assert.equal(released.success, true);
  assert.deepEqual(leaseKeys(repo), []);
});

test('--root=<dir> resolves relative paths and the board from that directory (both flag forms)', (t) => {
  const repo = withMonorepo(t);
  const equals = runTeamCli(['lock', 'acquire', `--root=${repo.pkgB}`, 'src/y.js', '--as=@spec-a'], false, repo.pkgA);
  assert.equal(equals.granted, true);
  assert.equal(equals.lease.file_path, 'packages/b/src/y.js');
  const spaced = runTeamCli(['lock', '--root', repo.pkgA, 'src/x.js', '--as=@spec-a'], false, repo.loose);
  assert.equal(spaced.granted, true);
  assert.equal(spaced.lease.file_path, 'packages/a/src/x.js');
  assert.deepEqual(leaseKeys(repo).map((row) => row.file_path), ['packages/a/src/x.js', 'packages/b/src/y.js']);
});

test('--root=<dir> that is not a directory is refused before anything is leased', (t) => {
  const repo = withMonorepo(t);
  const missing = path.join(repo.root, 'no-such-dir');
  const run = capture(() => runTeamCli(['lock', `--root=${missing}`, 'src/y.js', '--as=@spec-a'], true, repo.pkgA));
  assert.equal(run.result.error, 'root_not_found');
  assert.match(run.err, /--root .* is not a directory/);
  assert.deepEqual(leaseKeys(repo), []);
});

test('--purpose "text" with a space is a purpose, not one more path to lock', (t) => {
  const repo = withMonorepo(t);
  const res = runTeamCli(['lock', 'src/x.js', '--purpose', '#6747 editing', '--as=@spec-a'], false, repo.pkgA);
  assert.equal(res.granted, true);
  const rows = openTeamContext(repo.root).db.prepare('SELECT file_path, purpose FROM file_leases').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ file_path: 'packages/a/src/x.js', purpose: '#6747 editing' }]);
});
