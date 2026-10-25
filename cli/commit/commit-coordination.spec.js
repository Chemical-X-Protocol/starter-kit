/**
 * chemx commit from a submodule (#2488): the event goes to the coordination db, never into the
 * package's own code-index db, so the package is not turned into a legacy silo. Every project is a
 * temp dir (fs.mkdtemp via coordination-fixture.js); CHEMX_PROJECT_ROOT is deleted below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openIndexDb } from '../search-schema.js';
import { createTask } from '../team/team-db-tasks.js';
import { registerAgent } from '../team/team-db-agents.js';
import { claimWithIgnoreDeps } from '../team/claim-ignore-deps.js';
import { queryFeed } from '../team/team-db-feed.js';
import { resolveTeamDbTarget } from '../team/coordination-db.js';
import { buildMonorepo } from '../team/coordination-fixture.js';
import { runCommit } from './commit-run.js';

delete process.env.CHEMX_PROJECT_ROOT;

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

const cleanEnv = () => {
  const env = { ...process.env };
  ['CHEMX_COAUTHOR', 'CLAUDE_SESSION_ID', 'CHEMX_SESSION_ID', 'CHEMX_PROJECT_ROOT'].forEach((key) => delete env[key]);
  return { ...env, CHEMX_AGENT_ID: '@spec-a' };
};

const initPackageRepo = (pkg) => {
  git(pkg, ['init', '-q']);
  git(pkg, ['config', 'user.name', 'Spec']);
  git(pkg, ['config', 'user.email', 'spec@example.invalid']);
  git(pkg, ['config', 'commit.gpgsign', 'false']);
  git(pkg, ['add', 'package.json']);
  git(pkg, ['commit', '-q', '-m', 'init']);
};

test('a commit from a submodule with a code-index-only db records on the coordination db and leaves the package db team-free', async (t) => {
  const repo = buildMonorepo();
  t.after(() => repo.cleanup());
  initPackageRepo(repo.pkgA);
  const rootDb = openIndexDb(repo.root);
  const task = createTask(rootDb, { title: 'root task' });
  const pkgDb = openIndexDb(repo.pkgA);
  fs.writeFileSync(path.join(repo.pkgA, 'a.txt'), 'a\n');
  const before = resolveTeamDbTarget(repo.pkgA);
  const result = await runCommit(['a.txt', '-m', `add a (#${task.id})`], { cwd: repo.pkgA, env: cleanEnv(), sleep: async () => {} });
  const after = resolveTeamDbTarget(repo.pkgA);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data.recorded, true);
  assert.equal(queryFeed(rootDb, { event_type: 'commit' }).length, 1);
  assert.equal(queryFeed(pkgDb, { event_type: 'commit' }).length, 0);
  assert.deepEqual([before.root, before.mode], [repo.root, 'superproject']);
  assert.deepEqual([after.root, after.mode], [repo.root, 'superproject']);
});

test('--task from a submodule finds a board task that exists only in the coordination db', async (t) => {
  const repo = buildMonorepo();
  t.after(() => repo.cleanup());
  initPackageRepo(repo.pkgA);
  const rootDb = openIndexDb(repo.root);
  const task = createTask(rootDb, { title: 'board task' });
  openIndexDb(repo.pkgA);
  fs.writeFileSync(path.join(repo.pkgA, 'b.txt'), 'b\n');
  const result = await runCommit(['b.txt', '-m', 'add b', `--task=${task.id}`], { cwd: repo.pkgA, env: cleanEnv(), sleep: async () => {} });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(git(repo.pkgA, ['log', '-1', '--format=%s']).stdout.trim().length > 0, true);
});

// Two unrelated boards (#6750): the handle claimed its task on the app board, then commits from a
// repo whose directory resolves to another board. Every root is a temp dir.
const makeBoardRepo = (t, taskCount) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-board-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initPackageRepo(root);
  const db = openIndexDb(root);
  for (let n = 0; n < taskCount; n += 1) createTask(db, { title: `task ${n + 1}` });
  return { root, db };
};

const useClaimsDir = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-claims-')));
  process.env.CHEMX_BOARD_CLAIMS_DIR = dir;
  t.after(() => {
    delete process.env.CHEMX_BOARD_CLAIMS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
};

const claimOn = (board, id, handle) => {
  registerAgent(board.db, { id: handle, role: 'executor' });
  const res = claimWithIgnoreDeps(board.db, id, handle, undefined, { root: board.root, env: process.env });
  assert.equal(res.success, true);
};

const commitFile = async (repo, extra) => {
  fs.writeFileSync(path.join(repo.root, 'f.txt'), 'f\n');
  return runCommit(['f.txt', ...extra], { cwd: repo.root, env: cleanEnv(), sleep: async () => {} });
};
const commitEvents = (db) => queryFeed(db, { event_type: 'commit' });

test('a commit where another board rules is checked against, and recorded on, the board of the handle\'s claim', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  claimOn(app, 10, '@h');
  const result = await commitFile(plugin, ['-m', 'x (#10)', '--as=@h']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data.recorded, true);
  assert.equal(result.data.board, app.root);
  assert.match(result.lines.join('\n'), new RegExp(`board: ${app.root} \\(claim\\)`));
  assert.deepEqual(commitEvents(app.db).map((event) => event.task_id), [10]);
  assert.equal(commitEvents(plugin.db).length, 0);
});

test('the same holds when the directory board has an unrelated task with that number', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 10);
  claimOn(app, 10, '@h');
  const result = await commitFile(plugin, ['-m', 'x (#10)', '--as=@h']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(commitEvents(app.db).map((event) => event.task_id), [10]);
  assert.equal(commitEvents(plugin.db).length, 0);
});

test('without a claim the directory board is used, and a number it lacks is refused naming that board', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  const result = await commitFile(plugin, ['-m', 'x (#10)', '--as=@h']);
  assert.equal(result.ok, false);
  assert.match(result.refusals.join('\n'), /task #10 was not found/);
  assert.match(result.refusals.join('\n'), new RegExp(`${plugin.root} \\(this directory\\)`));
  assert.doesNotMatch(result.refusals.join('\n'), new RegExp(app.root));
});

test('a number no board has is refused naming both boards that were searched', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  claimOn(app, 10, '@h');
  const result = await commitFile(plugin, ['-m', 'x (#77)', '--as=@h']);
  assert.equal(result.ok, false);
  const text = result.refusals.join('\n');
  assert.match(text, /task #77 was not found/);
  assert.match(text, new RegExp(`${app.root} \\(your claim\\)`));
  assert.match(text, new RegExp(`${plugin.root} \\(this directory\\)`));
  assert.equal(commitEvents(app.db).length, 0);
});

test('--board=<dir> checks and records on the named board, claim or not', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  const result = await commitFile(plugin, ['-m', 'x (#10)', '--as=@h', `--board=${app.root}`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data.board, app.root);
  assert.deepEqual(commitEvents(app.db).map((event) => event.task_id), [10]);
});

test('--board naming a directory with no team db is refused before anything is staged', async (t) => {
  useClaimsDir(t);
  const plugin = makeBoardRepo(t, 3);
  const result = await commitFile(plugin, ['-m', 'x (#1)', '--as=@h', `--board=${path.join(plugin.root, 'nope')}`]);
  assert.equal(result.ok, false);
  assert.match(result.refusals.join('\n'), /does not exist/);
  assert.equal(git(plugin.root, ['diff', '--cached', '--name-only']).stdout, '');
});

test('--no-task with a #id in the subject neither scans nor refuses; the unattached event lands on the claim board', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  claimOn(app, 10, '@h');
  const result = await commitFile(plugin, ['-m', 'chore: move the #99 notes', '--no-task=notes', '--as=@h']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(commitEvents(app.db).map((event) => event.task_id), [null]);
  assert.equal(commitEvents(plugin.db).length, 0);
});

test('--release still releases the committer\'s leases on the directory board when the event goes to another board', async (t) => {
  useClaimsDir(t);
  const app = makeBoardRepo(t, 10);
  const plugin = makeBoardRepo(t, 3);
  claimOn(app, 10, '@h');
  const { requestFileLock, getFileLockStatus } = await import('../team/team-db-locks.js');
  requestFileLock(plugin.db, 'f.txt', '@h', { cwd: plugin.root, purpose: '#10' });
  const result = await commitFile(plugin, ['-m', 'x (#10)', '--as=@h', '--release']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(result.data.released, ['f.txt']);
  assert.equal(getFileLockStatus(plugin.db, 'f.txt', { cwd: plugin.root }).lease, null);
});
