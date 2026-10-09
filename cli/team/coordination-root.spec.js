/**
 * #2488 part A: one coordination root for every entry point.
 * All projects are temp dirs (fs.mkdtemp via coordination-fixture.js); CHEMX_PROJECT_ROOT is
 * deleted so no spec can reach a real .chemx/index.db.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCoordinationRoot } from './coordination-root.js';
import { resolveTeamDbTarget, openTeamContext } from './coordination-db.js';
import { owningRepo } from './coordination-repos.js';
import { buildMonorepo, buildStandalone, makeTempDir } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { initTeamSchema } from './team-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_DIR = fileURLToPath(new URL('../..', import.meta.url));

const withFixture = async (fn) => {
  const repo = buildMonorepo();
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

test('resolution: root, registered submodule, absorbed submodule, nested dir and workspace package all reach the superproject', () => withFixture((repo) => {
  for (const start of [repo.root, repo.pkgA, repo.pkgB, repo.pkgC, path.join(repo.pkgA, 'deep', 'nested'), repo.loose]) {
    const resolved = resolveCoordinationRoot(start);
    assert.equal(resolved.root, repo.root, `from ${start}`);
    assert.equal(resolved.refused, null);
  }
  assert.equal(resolveCoordinationRoot(repo.pkgA).mode, 'superproject');
  assert.equal(resolveCoordinationRoot(repo.root).mode, 'workspace');
}));

test('resolution: an unrelated repo above a checkout is never a superproject', () => withFixture((repo) => {
  const inner = path.join(repo.root, 'loose', 'clone');
  fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
  fs.writeFileSync(path.join(inner, 'package.json'), '{"name":"clone"}');
  const resolved = resolveCoordinationRoot(inner);
  assert.equal(resolved.root, inner);
  assert.equal(resolved.mode, 'standalone');
}));

test('resolution: a package cloned on its own is standalone', () => {
  const solo = buildStandalone();
  try {
    const resolved = resolveCoordinationRoot(path.join(solo.root, 'src'));
    assert.deepEqual([resolved.root, resolved.mode], [solo.root, 'standalone']);
  } finally {
    solo.cleanup();
  }
});

test('resolution: a workspace without git resolves to the outermost workspace root', () => {
  const root = makeTempDir('chemx-ws-');
  try {
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    fs.mkdirSync(path.join(root, 'apps', 'one', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'one', 'package.json'), '{"name":"one"}');
    const resolved = resolveCoordinationRoot(path.join(root, 'apps', 'one', 'src'));
    assert.deepEqual([resolved.root, resolved.mode], [root, 'workspace']);
    assert.equal(owningRepo(root, path.join(root, 'apps', 'one', 'src', 'a.js')), 'apps/one');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolution: a spec process is refused a root outside the temp dir; a non-spec env is not', () => {
  const specEnv = { NODE_TEST_CONTEXT: 'child-v8' };
  const refused = resolveCoordinationRoot(KIT_DIR, { env: specEnv });
  assert.match(refused.refused, /spec process refused/);
  const target = resolveTeamDbTarget(KIT_DIR, { env: specEnv });
  assert.ok(target.refused, 'the db target carries the refusal');
  assert.equal(resolveCoordinationRoot(KIT_DIR, { env: {} }).refused, null);
  const ctx = openTeamContext(KIT_DIR, { env: specEnv });
  assert.equal(ctx.db, null, 'no handle is opened for a refused root');
});

test('repos: owning package of a path, relative to the coordination root', () => withFixture((repo) => {
  assert.equal(owningRepo(repo.root, path.join(repo.pkgA, 'src', 'x.js')), 'packages/a');
  assert.equal(owningRepo(repo.root, path.join(repo.pkgB, 'src', 'y.js')), 'packages/b');
  assert.equal(owningRepo(repo.root, path.join(repo.loose, 'z.js')), '.');
  assert.equal(owningRepo(repo.root, path.dirname(repo.root)), null);
}));

test('CLI from the root and from a submodule share one db; MCP with projectRoot=submodule ignores CHEMX_PROJECT_ROOT', async () => withFixture(async (repo) => {
  const decoy = makeTempDir('chemx-decoy-');
  try {
    const fromRoot = runTeamCli(['task', 'add', 'made at root', '--as=@spec-root'], false, repo.root);
    const fromSub = runTeamCli(['task', 'add', 'made in a', '--as=@spec-a'], false, repo.pkgA);
    assert.equal(fromRoot.repo, '.');
    assert.equal(fromSub.repo, 'packages/a');
    assert.ok(fs.existsSync(path.join(repo.root, '.chemx', 'index.db')));
    assert.equal(fs.existsSync(path.join(repo.pkgA, '.chemx', 'index.db')), false, 'no package db is created');
    process.env.CHEMX_PROJECT_ROOT = decoy;
    const viaMcp = await handleChemxTeamTask({ action: 'list', allRepos: true, scope: true }, repo.pkgA);
    delete process.env.CHEMX_PROJECT_ROOT;
    const ids = viaMcp.rows.map((row) => row[viaMcp.cols.indexOf('id')]);
    assert.deepEqual(ids.sort(), [fromRoot.id, fromSub.id].sort());
    assert.equal(viaMcp.board, path.join(repo.root, '.chemx', 'index.db'));
    assert.equal(fs.existsSync(path.join(decoy, '.chemx', 'index.db')), false, 'CHEMX_PROJECT_ROOT never receives team rows');
  } finally {
    delete process.env.CHEMX_PROJECT_ROOT;
    fs.rmSync(decoy, { recursive: true, force: true });
  }
}));

test('an unmerged package db with team rows keeps serving its package (legacy) until a merge records it', async () => withFixture(async (repo) => {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.join(repo.pkgB, '.chemx'));
  const silo = new DatabaseSync(path.join(repo.pkgB, '.chemx', 'index.db'));
  initTeamSchema(silo);
  silo.prepare("INSERT INTO agent_tasks (title, created_at, updated_at) VALUES ('old b task', 1, 1)").run();
  silo.close();
  const target = resolveTeamDbTarget(repo.pkgB);
  assert.deepEqual([target.root, target.mode, target.repo], [repo.pkgB, 'legacy', '.']);
  assert.equal(resolveTeamDbTarget(repo.pkgA).root, repo.root, 'other packages still use the coordination db');
  const board = openTeamContext(repo.root).db;
  board.prepare("INSERT INTO team_merge_runs (source_db, source_repo, keep_ids, started_at) VALUES (?, 'packages/b', 'target', 1)").run(fs.realpathSync(path.join(repo.pkgB, '.chemx', 'index.db')));
  const after = resolveTeamDbTarget(repo.pkgB);
  assert.deepEqual([after.root, after.mode, after.repo], [repo.root, 'superproject', 'packages/b']);
}));
