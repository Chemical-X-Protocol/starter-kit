/**
 * chemx commit names an unsplit zsh variable (#6773): `chemx commit $files` hands zsh's one joined
 * argument to the command, and "not tracked and not on disk: a.txt b.txt" blamed the files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openIndexDb } from '../search-schema.js';
import { createTask } from '../team/team-db-tasks.js';
import { runCommit } from './commit-run.js';
import { UNSPLIT_HINT } from '../args-unsplit-hint.js';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

const cleanEnv = () => {
  const env = { ...process.env };
  ['CHEMX_COAUTHOR', 'CLAUDE_SESSION_ID', 'CHEMX_SESSION_ID', 'CHEMX_PROJECT_ROOT'].forEach((key) => delete env[key]);
  return { ...env, CHEMX_AGENT_ID: '@spec-a' };
};

const makeRepo = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-unsplit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['config', 'user.name', 'Spec']);
  git(root, ['config', 'user.email', 'spec@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '-q', '-m', 'init']);
  const task = createTask(openIndexDb(root), { title: 'spec task' });
  return { root, taskId: task.id };
};

const run = (root, args) => runCommit(args, { cwd: root, env: cleanEnv(), sleep: async () => {} });

test('one joined argument for two real files is refused with the zsh hint, nothing committed', async (t) => {
  const { root, taskId } = makeRepo(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  const result = await run(root, ['a.txt b.txt', '-m', `add (#${taskId})`]);
  const refusals = result.refusals.join('\n');
  assert.equal(result.ok, false);
  assert.match(refusals, /not tracked and not on disk: a\.txt b\.txt/);
  assert.ok(refusals.includes(UNSPLIT_HINT), refusals);
  assert.equal(git(root, ['rev-list', '--count', 'HEAD']).stdout.trim(), '1');
});

test('a missing file with no spaces keeps the plain message, no hint', async (t) => {
  const { root, taskId } = makeRepo(t);
  const result = await run(root, ['nope.txt', '-m', `x (#${taskId})`]);
  const refusals = result.refusals.join('\n');
  assert.match(refusals, /not tracked and not on disk: nope\.txt/);
  assert.ok(!refusals.includes('zsh'), refusals);
});

test('a real file with a space in its name commits without any hint', async (t) => {
  const { root, taskId } = makeRepo(t);
  fs.writeFileSync(path.join(root, 'my notes.txt'), 'n\n');
  const result = await run(root, ['my notes.txt', '-m', `add notes (#${taskId})`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
});
