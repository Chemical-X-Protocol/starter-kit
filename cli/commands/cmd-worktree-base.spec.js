/**
 * K24 (#6777): `chemx worktree add` records the branch it was cut from (beside the worktree's git dir),
 * and `chemx worktree remove` accepts a merge into it as well as into the default branch.
 * Temp git repos with a local bare "origin"; no network. Fixture: worktree-fixture.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorktreeBase, recordWorktreeBase } from '../worktree-base.js';
import { git, makeProject, run, addWithCommit } from './worktree-fixture.js';

const recordFile = (target) => path.join(git(target, 'rev-parse', '--absolute-git-dir'), 'chemx-worktree.json');

// The main checkout's local main gets a commit origin does not have (the K21 benchmark layout).
const aheadOfOrigin = (project) => {
  fs.writeFileSync(path.join(project.main, 'ahead.txt'), 'ahead\n');
  git(project.main, 'add', 'ahead.txt');
  git(project.main, 'commit', '-q', '-m', 'local only');
};

const commitIn = (target, file, text) => {
  fs.writeFileSync(path.join(target, file), text);
  git(target, 'add', file);
  git(target, 'commit', '-q', '-m', `change ${file}`);
};

test('add records the branch it was cut from beside the worktree\'s git dir: the default, or --from', async (t) => {
  const project = makeProject(t);
  const plain = path.join(project.trees, 'rec-default');
  const from = path.join(project.trees, 'rec-from');

  await run(['add', plain, '-b', 'fix/rec-default'], project.main);
  await run(['add', from, '-b', 'fix/rec-from', '--from', 'main'], project.main);

  assert.deepEqual(readWorktreeBase(plain, 'fix/rec-default'), { base: 'origin/main', problem: null });
  assert.deepEqual(readWorktreeBase(from, 'fix/rec-from'), { base: 'main', problem: null });
  assert.equal(JSON.parse(fs.readFileSync(recordFile(from), 'utf8')).base, 'main');
  assert.equal(git(from, 'status', '--porcelain'), '', 'the record is not a file of the working tree');
  assert.equal(fs.existsSync(path.join(from, '.chemx', 'chemx-worktree.json')), false);
});

test('add --from HEAD or a commit id records a name that still means something later: the branch, or the commit', async (t) => {
  const project = makeProject(t);
  const viaHead = path.join(project.trees, 'rec-head');
  const viaId = path.join(project.trees, 'rec-id');
  const id = git(project.main, 'rev-parse', 'main');

  await run(['add', viaHead, '-b', 'fix/rec-head', '--from', 'HEAD'], project.main);
  await run(['add', viaId, '-b', 'fix/rec-id', '--from', id.slice(0, 8)], project.main);

  assert.equal(readWorktreeBase(viaHead, 'fix/rec-head').base, 'main');
  assert.equal(readWorktreeBase(viaId, 'fix/rec-id').base, id);
});

test('recordWorktreeBase says why it could not record', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wt-rec-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  const result = recordWorktreeBase(outside, 'fix/x', 'main');

  assert.equal(result.ok, false);
  assert.match(result.problem, /no git dir/);
});

test('remove: a branch fast-forwarded into the local branch it was cut from (ahead of origin) needs no --force', async (t) => {
  const project = makeProject(t);
  aheadOfOrigin(project);
  const target = path.join(project.trees, 'ahead');
  await run(['add', target, '-b', 'fix/ahead', '--from', 'main'], project.main);
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'merge', '-q', '--ff-only', 'fix/ahead');

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(target), false);
  assert.equal(git(project.main, 'branch', '--list', 'fix/ahead'), '');
  assert.match(result.out, /deleted branch fix\/ahead \(merged into main\)/);
});

test('remove: a branch squash-merged into the local branch it was cut from counts as merged', async (t) => {
  const project = makeProject(t);
  aheadOfOrigin(project);
  const target = path.join(project.trees, 'ahead-squash');
  await run(['add', target, '-b', 'fix/ahead-squash', '--from', 'main'], project.main);
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'merge', '--squash', 'fix/ahead-squash');
  git(project.main, 'commit', '-q', '-m', 'squash of ahead-squash');

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.equal(git(project.main, 'branch', '--list', 'fix/ahead-squash'), '');
  assert.match(result.out, /squash-merged into main/);
});

test('remove: the default branch is judged first, so a branch merged into origin/main still says origin/main', async (t) => {
  const project = makeProject(t);
  const target = path.join(project.trees, 'both');
  await run(['add', target, '-b', 'fix/both', '--from', 'main'], project.main);
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'merge', '-q', '--ff-only', 'fix/both');
  git(project.main, 'push', '-q');

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /merged into origin\/main/);
});

test('remove: an unmerged branch cut from a local branch is refused, and the refusal names both bases', async (t) => {
  const project = makeProject(t);
  aheadOfOrigin(project);
  const target = path.join(project.trees, 'unmerged-from');
  await run(['add', target, '-b', 'fix/unmerged-from', '--from', 'main'], project.main);
  commitIn(target, 'new.txt', 'work\n');

  const refused = await run(['remove', target], project.main);

  assert.equal(refused.code, 1);
  assert.match(refused.err, /fix\/unmerged-from is not merged into origin\/main or main\b.*--force/s);
  assert.ok(fs.existsSync(target));
  assert.equal(git(project.main, 'branch', '--list', '--format=%(refname:short)', 'fix/unmerged-from'), 'fix/unmerged-from');
});

test('remove: a branch cut from the default branch names it once', async (t) => {
  const project = makeProject(t);
  const { target } = await addWithCommit(project, 'names-once');

  const refused = await run(['remove', target], project.main);

  assert.equal(refused.code, 1);
  assert.match(refused.err, /is not merged into origin\/main \(git fetch first/);
  assert.doesNotMatch(refused.err, / or /);
});

test('remove: a worktree made by plain git has no record, so only the default branch is judged', async (t) => {
  const project = makeProject(t);
  aheadOfOrigin(project);
  const target = path.join(project.trees, 'plain-git');
  git(project.main, 'worktree', 'add', '-q', '-b', 'fix/plain-git', target, 'main');
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'merge', '-q', '--ff-only', 'fix/plain-git');

  const refused = await run(['remove', target], project.main);

  assert.deepEqual(readWorktreeBase(target, 'fix/plain-git'), { base: null, problem: null });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /not merged into origin\/main \(/);
  assert.ok(fs.existsSync(target));
});

test('remove: a recorded base that is gone is named in the refusal, and the default branch still decides', async (t) => {
  const project = makeProject(t);
  git(project.main, 'branch', 'feature/base');
  const target = path.join(project.trees, 'gone-base');
  await run(['add', target, '-b', 'fix/gone-base', '--from', 'feature/base'], project.main);
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'branch', '-D', 'feature/base');

  const refused = await run(['remove', target], project.main);

  assert.equal(refused.code, 1);
  assert.match(refused.err, /not merged into origin\/main \(.*feature\/base.*no longer/s);

  git(project.main, 'merge', '-q', '--ff-only', 'fix/gone-base');
  git(project.main, 'push', '-q');
  const removed = await run(['remove', target], project.main);

  assert.equal(removed.code, 0, removed.err);
  assert.match(removed.out, /merged into origin\/main/);
});

test('remove: a record written for another branch is ignored, and an unreadable one is named in the refusal', async (t) => {
  const project = makeProject(t);
  aheadOfOrigin(project);
  const target = path.join(project.trees, 'switched');
  await run(['add', target, '-b', 'fix/one', '--from', 'main'], project.main);
  git(target, 'switch', '-q', '-c', 'fix/two');
  commitIn(target, 'new.txt', 'work\n');
  git(project.main, 'merge', '-q', '--ff-only', 'fix/two');

  const switched = await run(['remove', target], project.main);

  assert.deepEqual(readWorktreeBase(target, 'fix/two'), { base: null, problem: null });
  assert.equal(switched.code, 1);
  assert.match(switched.err, /fix\/two is not merged into origin\/main \(/);

  fs.writeFileSync(recordFile(target), '{not json');
  const garbled = await run(['remove', target], project.main);

  assert.equal(garbled.code, 1);
  assert.match(garbled.err, /chemx-worktree\.json.*unreadable/s);
  assert.ok(fs.existsSync(target));
});

