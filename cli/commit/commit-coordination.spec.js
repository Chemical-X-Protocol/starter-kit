/**
 * chemx commit from a submodule (#2488): the event goes to the coordination db, never into the
 * package's own code-index db, so the package is not turned into a legacy silo. Temp dirs only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openIndexDb } from '../search-schema.js';
import { createTask } from '../team/team-db-tasks.js';
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
