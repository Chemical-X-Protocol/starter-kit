/**
 * #2581: entry points that used to open the cwd's index db for team rows now use the coordination db:
 * MCP task done --target (re-based like the CLI), the project tools (CLI and MCP) and the studio UI
 * server. The code index stays per package. Temp monorepo only (fs.mkdtemp via
 * coordination-fixture.js); CHEMX_PROJECT_ROOT is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { handleChemxProject } from '../mcp/tools-project.js';
import { runProjectCli } from '../commands/cmd-project.js';
import { createUiServer } from '../ui-server.js';
import { routeGet } from '../ui-server-routes.js';

delete process.env.CHEMX_PROJECT_ROOT;

const withFixture = async (fn) => {
  const repo = buildMonorepo('chemx-entry-');
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

const boardDb = (repo) => openTeamContext(repo.root).db;

test('MCP task done re-bases --target to its owning repo, like the CLI', () => withFixture(async (repo) => {
  const task = await handleChemxTeamTask({ action: 'add', title: 'retarget me', agentId: '@spec-a' }, repo.root);
  await handleChemxTeamTask({ action: 'claim', taskId: task.id, agentId: '@spec-a' }, repo.root);
  await handleChemxTeamTask({ action: 'done', taskId: task.id, target: 'packages/a/src/x.js', agentId: '@spec-a', force: true }, repo.root);
  const row = boardDb(repo).prepare('SELECT repo, target_path FROM agent_tasks WHERE id = ?').get(task.id);
  assert.deepEqual({ ...row }, { repo: 'packages/a', target_path: 'src/x.js' });
  const fromPackage = await handleChemxTeamTask({ action: 'add', title: 'sibling target', agentId: '@spec-a' }, repo.pkgA);
  await handleChemxTeamTask({ action: 'done', taskId: fromPackage.id, target: '../b/src/y.js', agentId: '@spec-a', force: true }, repo.pkgA);
  const sibling = boardDb(repo).prepare('SELECT repo, target_path FROM agent_tasks WHERE id = ?').get(fromPackage.id);
  assert.deepEqual({ ...sibling }, { repo: 'packages/b', target_path: 'src/y.js' }, 'a relative target resolves from the caller and lands in its own repo');
  const outside = await handleChemxTeamTask({ action: 'done', taskId: fromPackage.id, target: '../../../outside.js', agentId: '@spec-a', force: true }, repo.pkgA);
  assert.equal(outside.refused, true, 'a target outside the coordination root is refused');
}));

test('project tools keep sessions in the coordination db, not the package index', () => withFixture(async (repo) => {
  const session = await handleChemxProject({ subAction: 'init', goal: 'spec goal' }, repo.pkgA);
  assert.ok(session?.id);
  const cliStatus = await runProjectCli(['status', '--json'], false, repo.pkgB);
  assert.equal(cliStatus.session?.id, session.id, 'the CLI from another package sees the same session');
  assert.equal(boardDb(repo).prepare('SELECT COUNT(*) AS n FROM project_sessions').get().n, 1);
  assert.equal(fs.existsSync(path.join(repo.pkgA, '.chemx', 'index.db')), false, 'no package db was created for team rows');
}));

test('the studio UI reads team rows from the coordination db and code data from the package index', () => withFixture((repo) => {
  runTeamCli(['task', 'add', 'board task', '--as=@spec-root'], false, repo.root);
  const { server, db, indexDb } = createUiServer(repo.pkgA);
  try {
    assert.notEqual(db, indexDb, 'the package keeps its own index handle');
    const tasks = routeGet('/api/tasks', db, repo.pkgA, {}, { indexDb }).tasks.map((task) => task.title);
    assert.deepEqual(tasks, ['board task']);
    const status = routeGet('/api/status', db, repo.pkgA, {}, { indexDb });
    assert.equal(status.success, true);
  } finally {
    server.close(() => {});
  }
}));
