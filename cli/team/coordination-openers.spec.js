/**
 * #2581: every opener of team rows goes through the coordination resolver.
 *   - #2570 rule: a walk stops at the first project marker and never resolves or creates a db at the
 *     OS temp dir or the filesystem root (a stray .chemx above a temp project is ignored);
 *   - before a migrate, a lock from the root and one from an unmerged package db collide;
 *   - chemx status/wait read the same dbs the resolver names;
 *   - a spec process never opens a real db through the read-only openers.
 * Temp dirs only (fs.mkdtemp); TMPDIR is pointed at a temp dir for the stray-.chemx case and restored;
 * CHEMX_PROJECT_ROOT is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildMonorepo, makeTempDir } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { initTeamSchema } from './team-schema.js';
import { resolveCoordinationRoot } from './coordination-root.js';
import { teamDbRootsFor, resolveTeamDbTarget } from './coordination-target.js';
import { openTeamDbReadOnly, openExistingTeamDb } from './team-db-readonly.js';
import { findChemxDir } from '../audit/chemx-dir.js';
import { liveLeases, taskStatus } from '../lease-view.js';
import { findForeignLease } from '../edit-locks.js';
import { findLedgerDbPath } from '../telemetry/call-ledger.js';
import { createUiServer } from '../ui-server.js';
import { checkStagedLeases } from './staged-leases.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FAR = Date.now() + 3600000;

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// A team db at dir with one task and, optionally, a lease row.
const seedTeamDb = (dir, { lease } = {}) => {
  fs.mkdirSync(path.join(dir, '.chemx'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, '.chemx', 'index.db'));
  initTeamSchema(db);
  db.prepare("INSERT INTO agent_tasks (id, title, status, created_at, updated_at) VALUES (7, 'seeded', 'in_progress', 1, 1)").run();
  if (lease) db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at) VALUES (?, ?, ?, ?)').run(lease.file, lease.holder, 1, FAR);
  db.close();
};

// The temp dir is pointed at `outer`, which holds a stray .chemx (with a lease) and a stray package.json.
const withStrayTempDir = (fn) => {
  const outer = makeTempDir('chemx-stray-');
  const saved = process.env.TMPDIR;
  try {
    seedTeamDb(outer, { lease: { file: 'bare/src/a.js', holder: '@spec-stray' } });
    write(path.join(outer, 'package.json'), JSON.stringify({ name: 'stray', workspaces: ['*'] }));
    write(path.join(outer, 'proj', 'package.json'), JSON.stringify({ name: 'proj' }));
    fs.mkdirSync(path.join(outer, 'proj', 'src'), { recursive: true });
    fs.mkdirSync(path.join(outer, 'bare', 'src'), { recursive: true });
    process.env.TMPDIR = outer;
    assert.equal(fs.realpathSync(os.tmpdir()), outer, 'the fixture temp dir is in effect');
    return fn(outer);
  } finally {
    const wasUnset = saved === undefined;
    if (wasUnset) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    fs.rmSync(outer, { recursive: true, force: true });
  }
};

test('#2570: the index walk stops at the first project marker and ignores a stray .chemx at the temp dir', () => withStrayTempDir((outer) => {
  assert.equal(findChemxDir(path.join(outer, 'proj', 'src')), path.join(outer, 'proj', '.chemx'));
  assert.equal(findChemxDir(path.join(outer, 'bare', 'src')), path.join(outer, 'bare', 'src', '.chemx'), 'no marker: the start dir, never the stray');
  assert.throws(() => findChemxDir(outer), /will not use/);
  assert.throws(() => findChemxDir(path.parse(outer).root), /will not use/);
}));

test('#2570: CHEMX_PROJECT_ROOT naming the temp dir is refused', () => withStrayTempDir((outer) => {
  process.env.CHEMX_PROJECT_ROOT = outer;
  try {
    assert.throws(() => findChemxDir(path.join(outer, 'proj')), /will not use/);
  } finally {
    delete process.env.CHEMX_PROJECT_ROOT;
  }
}));

test('#2570: the coordination root never lands on the temp dir, and nothing reads the stray db', () => withStrayTempDir((outer) => {
  const bare = path.join(outer, 'bare', 'src');
  const resolved = resolveCoordinationRoot(bare);
  assert.equal(resolved.root, bare, 'neither the stray .chemx nor the stray workspace package.json above is a root');
  assert.equal(resolved.refused, null);
  assert.equal(resolveCoordinationRoot(path.join(outer, 'proj', 'src')).root, path.join(outer, 'proj'));
  assert.match(resolveCoordinationRoot(outer).refused, /will not use/);
  assert.deepEqual(teamDbRootsFor(bare), []);
  assert.deepEqual(liveLeases(bare), [], 'the stray lease is not visible');
  assert.equal(findForeignLease(bare, path.join(outer, 'bare', 'src', 'a.js'), '@spec-me'), null, 'the edit guard does not read the stray db');
  assert.equal(openTeamDbReadOnly(outer), null);
  assert.equal(openExistingTeamDb(outer), null);
  assert.equal(findLedgerDbPath(bare, {}), null, 'the call ledger does not write to the stray db');
  assert.equal(runTeamCli(['lock', 'acquire', 'a.js', '--as=@spec-me'], false, outer), null, 'a team command run from the temp dir itself is refused');
  assert.equal(fs.existsSync(path.join(bare, '.chemx')), false, 'nothing was created by the reads');
}));

const withSilo = async (fn) => {
  const repo = buildMonorepo('chemx-openers-');
  try {
    runTeamCli(['task', 'add', 'root task', '--as=@spec-root'], false, repo.root);
    seedTeamDb(repo.pkgA);
    assert.equal(resolveTeamDbTarget(repo.pkgA).mode, 'legacy', 'packages/a still has its own unmerged db');
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

test('before a migrate, a lock from the root and one from the package db collide (root first)', () => withSilo((repo) => {
  const first = runTeamCli(['lock', 'acquire', 'packages/a/src/x.js', '--as=@spec-root'], false, repo.root);
  assert.equal(first.granted, true);
  const second = runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub'], false, repo.pkgA);
  assert.equal(second.granted, false);
  assert.equal(second.reason, 'held_in_other_db');
  assert.equal(second.heldBy, '@spec-root');
  assert.match(second.message, /not queued here/);
  const again = runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-root'], false, repo.pkgA);
  assert.equal(again.granted, true, 'the holder itself is not refused by its own lease');
}));

test('before a migrate, a lock from the package db blocks the same file from the root', () => withSilo((repo) => {
  assert.equal(runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub'], false, repo.pkgA).granted, true);
  const fromRoot = runTeamCli(['lock', 'acquire', 'packages/a/src/x.js', '--as=@spec-root'], false, repo.root);
  assert.equal(fromRoot.reason, 'held_in_other_db');
  assert.equal(fromRoot.heldBy, '@spec-sub');
  const absolute = path.join(repo.pkgA, 'src', 'x.js');
  assert.equal(findForeignLease(repo.root, absolute, '@spec-root')?.lockedBy, '@spec-sub', 'the edit guard from the root sees it');
}));

test('status and wait read the dbs the resolver names: the package db and the coordination db', () => withSilo((repo) => {
  runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub'], false, repo.pkgA);
  runTeamCli(['lock', 'acquire', 'loose/dir/n.js', '--as=@spec-root'], false, repo.root);
  assert.deepEqual(teamDbRootsFor(path.join(repo.pkgA, 'src')), [repo.pkgA, repo.root]);
  const fromPackage = liveLeases(repo.pkgA).map((lease) => lease.abs).sort();
  assert.deepEqual(fromPackage, [path.join(repo.root, 'loose', 'dir', 'n.js'), path.join(repo.pkgA, 'src', 'x.js')]);
  const fromRoot = liveLeases(repo.root).map((lease) => lease.abs);
  assert.deepEqual(fromRoot, [path.join(repo.root, 'loose', 'dir', 'n.js')], 'from the root, a package db is read only for a path inside it');
  const forFile = liveLeases(repo.root, Date.now(), [path.join(repo.pkgA, 'src')]).map((lease) => lease.abs);
  assert.ok(forFile.includes(path.join(repo.pkgA, 'src', 'x.js')), 'wait --lock-free passes the file dir');
  assert.equal(taskStatus(repo.pkgA, 7), 'in_progress', 'a task in the unmerged package db');
  assert.equal(taskStatus(repo.root, 7), null, 'the root board has no task 7');
}));

test('after a migrate, the edit and commit guards read the board only: a release there frees the file', () => withSilo((repo) => {
  const file = path.join(repo.pkgA, 'src', 'x.js');
  assert.equal(runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub'], false, repo.pkgA).granted, true);
  const source = path.join(repo.pkgA, '.chemx', 'index.db');
  const merged = runTeamCli(['migrate', '--from', source, '--source-repo=pkg-a', '--json'], false, repo.root);
  assert.ok(merged, 'the migrate ran');
  assert.ok(!teamDbRootsFor(repo.pkgA).includes(repo.pkgA), 'the merged package db is not listed');
  runTeamCli(['lock', 'release', 'packages/a/src/x.js', '--as=@spec-sub'], false, repo.root);
  assert.equal(findForeignLease(repo.pkgA, file, '@spec-other'), null, 'the frozen package row is not read');
  assert.equal(checkStagedLeases(['src/x.js'], '@spec-other', { root: repo.pkgA }).ok, true);
}));

// The OS temp dir is pointed elsewhere while the fixture stays where it was, so the fixture counts as a real project.
const withRealLookingRoot = async (fn) => {
  const repo = buildMonorepo('chemx-real-');
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-elsewhere-')));
  const saved = process.env.TMPDIR;
  try {
    process.env.TMPDIR = elsewhere;
    assert.match(resolveTeamDbTarget(repo.root).refused, /spec process refused/);
    return await fn(repo);
  } finally {
    const wasUnset = saved === undefined;
    if (wasUnset) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    fs.rmSync(elsewhere, { recursive: true, force: true });
    repo.cleanup();
  }
};

test('the studio UI keeps no team handle when the coordination resolver refuses', () => withRealLookingRoot((repo) => {
  const ui = createUiServer(repo.root);
  assert.equal(ui.db, null);
  ui.indexDb?.close?.();
}));

test('team migrate --into refuses a db in a root the resolver refuses', () => withRealLookingRoot((repo) => {
  const into = path.join(repo.root, '.chemx', 'index.db');
  const before = fs.existsSync(into);
  const source = makeTempDir('chemx-migrate-src-');
  seedTeamDb(source);
  const result = runTeamCli(['migrate', '--from', path.join(source, '.chemx', 'index.db'), `--into=${into}`, '--source-repo=x', '--json'], false, repo.root);
  assert.notEqual(result?.ok, true);
  assert.equal(fs.existsSync(path.join(repo.root, '.chemx', 'backups', 'team-migrate')), false, 'no backup was written');
  assert.equal(fs.existsSync(into), before);
  fs.rmSync(source, { recursive: true, force: true });
}));

test('a spec process never opens a real db through the read-only openers', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'runs under node --test');
  assert.equal(openTeamDbReadOnly(KIT_DIR), null);
  assert.equal(openExistingTeamDb(KIT_DIR), null);
  assert.deepEqual(teamDbRootsFor(KIT_DIR), []);
  assert.deepEqual(liveLeases(KIT_DIR), []);
  assert.equal(taskStatus(KIT_DIR, 1), null);
  assert.equal(findLedgerDbPath(KIT_DIR, process.env), null, 'the call ledger is refused too');
  assert.match(resolveTeamDbTarget(KIT_DIR).refused, /spec process refused/);
});
