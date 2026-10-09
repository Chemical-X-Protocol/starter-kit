/**
 * #2488 part A / #2506: tasks carry their owning repo and a repo-relative target.
 * Projects are temp dirs (fs.mkdtemp via coordination-fixture.js); CHEMX_PROJECT_ROOT is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { openIndexDb } from '../search-db.js';
import { autoGenerateTasksFromAudit } from './team-triage.js';
import { countEscapingHazards, generateTriageTasks } from './team-triage-generate.js';
import { buildDispatchPlan } from './team-dispatch.js';
import { formatTaskBriefLines } from './task-detail-sections.js';

delete process.env.CHEMX_PROJECT_ROOT;

const withFixture = async (fn) => {
  const repo = buildMonorepo('chemx-repo-');
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

const listIds = (args, cwd) => runTeamCli(['task', 'list', '--all', ...args], false, cwd).map((task) => task.id).sort((a, b) => a - b);

test('task add: repo comes from the target owning package, else the cwd; targets are repo-relative', () => withFixture((repo) => {
  const targeted = runTeamCli(['task', 'add', 'fix x', '--target=packages/a/src/x.js', '--as=@spec-repo'], false, repo.root);
  assert.deepEqual([targeted.repo, targeted.target_path], ['packages/a', 'src/x.js']);
  const fromSub = runTeamCli(['task', 'add', 'in b', '--as=@spec-repo'], false, repo.pkgB);
  assert.deepEqual([fromSub.repo, fromSub.target_path], ['packages/b', null]);
  const relative = runTeamCli(['task', 'add', 'rel', '--target=src/x.js', '--as=@spec-repo'], false, repo.pkgA);
  assert.deepEqual([relative.repo, relative.target_path], ['packages/a', 'src/x.js']);
  const brief = formatTaskBriefLines(targeted).join('\n');
  assert.match(brief, /Repo:.*packages\/a/);
}));

test('task add / set-target refuse a ../ target that leaves the coordination root', () => withFixture((repo) => {
  const refused = runTeamCli(['task', 'add', 'escape', '--target=../outside.js', '--as=@spec-repo'], false, repo.root);
  assert.equal(refused.refused, true);
  assert.match(refused.error, /outside/);
  assert.deepEqual(listIds(['--all-repos'], repo.root), []);
  const task = runTeamCli(['task', 'add', 'ok', '--as=@spec-repo'], false, repo.root);
  const retarget = runTeamCli(['task', 'set-target', String(task.id), '../../../nope.js'], false, repo.pkgA);
  assert.equal(retarget.refused, true);
  const moved = runTeamCli(['task', 'set-target', String(task.id), 'src/y.js'], false, repo.pkgB);
  assert.deepEqual([moved.repo, moved.target_path], ['packages/b', 'src/y.js']);
}));

test('task list defaults to the caller repo; --all-repos and --repo widen it', () => withFixture((repo) => {
  const atRoot = runTeamCli(['task', 'add', 'root one', '--as=@spec-repo'], false, repo.root);
  const inA = runTeamCli(['task', 'add', 'a one', '--as=@spec-repo'], false, repo.pkgA);
  assert.deepEqual(listIds([], repo.pkgA), [inA.id]);
  assert.deepEqual(listIds([], repo.root), [atRoot.id]);
  assert.deepEqual(listIds(['--all-repos'], repo.pkgA), [atRoot.id, inA.id]);
  assert.deepEqual(listIds(['--repo=packages/a'], repo.root), [inA.id]);
}));

test('triage attributes tasks to the owning repo and never files a ../ hazard (#2506)', () => withFixture((repo) => {
  fs.mkdirSync(path.join(repo.pkgA, '.chemx'));
  const indexDb = openIndexDb(repo.pkgA);
  const insert = indexDb.prepare('INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('src/x.js', 'SPEC_RULE', 'HIGH', '', 1, 'spec hazard', 'spec directive');
  insert.run('../b/src/y.js', 'SPEC_RULE', 'HIGH', '', 1, 'spec hazard', 'spec directive');
  const ctx = openTeamContext(repo.pkgA);
  assert.equal(ctx.root, repo.root);
  const created = autoGenerateTasksFromAudit(ctx.db, { cwd: repo.pkgA, indexDb, root: ctx.root, repo: ctx.repo });
  assert.deepEqual(created.map((task) => [task.repo, task.target_path]), [['packages/a', 'src/x.js']]);
  assert.equal(countEscapingHazards(indexDb), 1);
  // Generation alone (no reconcile, which would close the task: the fixture file itself is clean).
  const again = generateTriageTasks(ctx.db, { cwd: repo.pkgA, indexDb, root: ctx.root });
  assert.equal(again.length, 0, 'an open task for the same repo, file and rule is not duplicated');
}));

test('dispatch hands out root-relative files and skips a stored ../ target', () => withFixture((repo) => {
  const ctx = openTeamContext(repo.root);
  runTeamCli(['task', 'add', 'fix x', '--target=packages/a/src/x.js', '--needs=light', '--as=@spec-repo'], false, repo.root);
  ctx.db.prepare("INSERT INTO agent_tasks (title, target_path, repo, needs, created_at, updated_at) VALUES ('legacy escape', '../x-atoms/a.js', '.', 'light', 1, 1)").run();
  const plan = buildDispatchPlan(ctx.db, { root: ctx.root, leaseCheck: () => null, isKnownFile: () => true });
  const files = plan.batches.flatMap((batch) => batch.files);
  assert.deepEqual(files, ['packages/a/src/x.js']);
  assert.ok(files.every((file) => !file.startsWith('../')));
  assert.deepEqual(plan.skipped.map((entry) => entry.reason), ['target_outside_root']);
}));
