/**
 * chemx commit --hunks (#7599): only the chosen hunks of a file are committed, the rest stay in the
 * working tree, nothing another handle staged rides along, and bad specs refuse before anything is staged.
 * Temp git repos and temp team dbs only.
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
import { parseHunkSpecs, parseRanges, splitDiff } from './commit-hunks.js';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });
const write = (root, file, text) => fs.writeFileSync(path.join(root, file), text);
const lines = (count, edits = {}) => Array.from({ length: count }, (_, i) => edits[i + 1] ?? `line ${i + 1}`).join('\n') + '\n';

const cleanEnv = () => {
  const env = { ...process.env };
  ['CHEMX_AGENT_ID', 'CHEMX_COAUTHOR', 'CLAUDE_SESSION_ID', 'CHEMX_SESSION_ID', 'CHEMX_PROJECT_ROOT'].forEach((key) => delete env[key]);
  return { ...env, CHEMX_AGENT_ID: '@spec-a' };
};

const makeRepo = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hunks-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['config', 'user.name', 'Spec']);
  git(root, ['config', 'user.email', 'spec@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'shared.txt', lines(30));
  write(root, 'other.txt', 'other\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  const db = openIndexDb(root);
  const task = createTask(db, { title: 'spec task' });
  return { root, taskId: task.id };
};

const run = (root, args) => runCommit(args, { cwd: root, env: cleanEnv(), sleep: async () => {} });
const headDiff = (root) => git(root, ['show', '--format=', '-U0', 'HEAD']).stdout;
const commitCount = (root) => Number(git(root, ['rev-list', '--count', 'HEAD']).stdout.trim());

test('parses hunk numbers and ranges, and names a bad spec', () => {
  assert.deepEqual(parseRanges('1,3-4'), [1, 3, 4]);
  assert.equal(parseRanges('0'), null);
  assert.equal(parseRanges('4-2'), null);
  assert.equal(parseRanges('x'), null);
  const { specs, errors } = parseHunkSpecs(['a.js:2', 'b.js', 'c.js:q']);
  assert.deepEqual(specs, [{ file: 'a.js', numbers: [2] }]);
  assert.equal(errors.length, 2);
});

test('splits a diff into its header and numbered hunks', () => {
  const { header, hunks } = splitDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n@@ -5 +5 @@\n-c\n+d\n');
  assert.equal(header.length, 3);
  assert.equal(hunks.length, 2);
});

test('commits only the chosen hunks; the rest stay in the working tree and the index ends level', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'shared.txt', lines(30, { 3: 'mine one', 15: 'theirs', 28: 'mine two' }));
  const result = await run(root, ['--hunks=shared.txt:1,3', '-m', `take my hunks (#${taskId})`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  const committed = headDiff(root);
  assert.match(committed, /\+mine one/);
  assert.match(committed, /\+mine two/);
  assert.doesNotMatch(committed, /theirs/);
  assert.equal(commitCount(root), 2);
  assert.match(fs.readFileSync(path.join(root, 'shared.txt'), 'utf-8'), /theirs/);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout, '');
  const left = git(root, ['diff', '-U0']).stdout;
  assert.match(left, /\+theirs/);
  assert.doesNotMatch(left, /mine one|mine two/);
});

test('takes whole files beside the chosen hunks, and leaves what others staged alone', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'shared.txt', lines(30, { 3: 'mine', 20: 'theirs' }));
  write(root, 'other.txt', 'other, changed by me\n');
  write(root, 'peer.txt', 'a peer staged this\n');
  git(root, ['add', 'peer.txt']);
  const result = await run(root, ['other.txt', '--hunks=shared.txt:1', '-m', `mixed (#${taskId})`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  const files = git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(files, ['other.txt', 'shared.txt']);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout.trim(), 'peer.txt');
  assert.doesNotMatch(headDiff(root), /theirs/);
});

test('refuses a hunk that is not there, a bad spec and a file with no changes, committing nothing', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'shared.txt', lines(30, { 3: 'mine' }));
  const missing = await run(root, ['--hunks=shared.txt:2', '-m', `x (#${taskId})`]);
  const bad = await run(root, ['--hunks=shared.txt:zero', '-m', `x (#${taskId})`]);
  const clean = await run(root, ['--hunks=other.txt:1', '-m', `x (#${taskId})`]);
  assert.match(missing.refusals.join('\n'), /has 1 hunk\(s\) against HEAD; there is no hunk 2/);
  assert.match(bad.refusals.join('\n'), /is not <file>:/);
  assert.match(clean.refusals.join('\n'), /no changes against HEAD/);
  assert.equal(commitCount(root), 1);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout, '');
});
