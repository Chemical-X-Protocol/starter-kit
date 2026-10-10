/**
 * chemx commit from a superproject root (#4523): a path inside a submodule is committed in the
 * submodule; paths spanning repos are refused with the grouping. Temp repos only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCommit } from './commit-run.js';

const git = (cwd, args) => spawnSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf-8' });
const identify = (dir) => {
  git(dir, ['config', 'user.name', 'Spec']);
  git(dir, ['config', 'user.email', 'spec@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
};
const env = () => {
  const clean = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };
  ['CHEMX_COAUTHOR', 'CLAUDE_SESSION_ID', 'CHEMX_SESSION_ID', 'CHEMX_PROJECT_ROOT'].forEach((key) => delete clean[key]);
  return clean;
};

const makeSuper = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-sub-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin');
  const root = path.join(base, 'super');
  fs.mkdirSync(origin);
  fs.mkdirSync(root);
  git(origin, ['init', '-q']);
  identify(origin);
  fs.writeFileSync(path.join(origin, 'a.txt'), 'a\n');
  git(origin, ['add', '.']);
  git(origin, ['commit', '-q', '-m', 'init']);
  git(root, ['init', '-q']);
  identify(root);
  fs.writeFileSync(path.join(root, 'top.txt'), 'top\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['submodule', 'add', '-q', origin, 'sub']);
  git(root, ['commit', '-q', '-m', 'add sub']);
  identify(path.join(root, 'sub'));
  return root;
};

const run = (root, args) => runCommit(args, { cwd: root, env: env(), sleep: async () => {} });
const subHeadFiles = (root) => git(path.join(root, 'sub'), ['show', '--name-only', '--format=', 'HEAD']).stdout.split('\n').filter(Boolean);

test('a path inside a submodule is committed in the submodule, with repo-relative paths', async (t) => {
  const root = makeSuper(t);
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'changed\n');
  const result = await run(root, ['sub/a.txt', '-m', 'fix a', '--no-task=spec']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(subHeadFiles(root), ['a.txt']);
  assert.deepEqual(result.data.files, ['a.txt']);
});

test('the bare submodule path is a pointer bump committed in the superproject', async (t) => {
  const root = makeSuper(t);
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'changed\n');
  git(path.join(root, 'sub'), ['commit', '-q', '-am', 'move']);
  const result = await run(root, ['sub', '-m', 'bump sub', '--no-task=spec']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout.split('\n').filter(Boolean), ['sub']);
});

test('a file outside any git repository is refused, not dropped', async (t) => {
  const root = makeSuper(t);
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-stray-'));
  t.after(() => fs.rmSync(stray, { recursive: true, force: true }));
  fs.writeFileSync(path.join(stray, 'x.txt'), 'x\n');
  fs.writeFileSync(path.join(root, 'top.txt'), 'changed\n');
  const result = await run(root, ['top.txt', path.join(stray, 'x.txt'), '-m', 'm', '--no-task=spec']);
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /not inside any git repository/);
});

test('files spanning the superproject and a submodule are refused with the grouping', async (t) => {
  const root = makeSuper(t);
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(root, 'top.txt'), 'changed\n');
  const result = await run(root, ['sub/a.txt', 'top.txt', '-m', 'mixed', '--no-task=spec']);
  assert.equal(result.ok, false);
  const text = result.lines.join('\n');
  assert.match(text, /more than one git repository/);
  assert.match(text, /sub: sub\/a\.txt/);
  assert.match(text, /super: top\.txt/);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout.trim(), '');
});
