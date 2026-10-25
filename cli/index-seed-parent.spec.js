/**
 * Where a linked worktree's parent index lives (#6769, K8b): the `.git` file's gitdir pointer and the
 * worktree gitdir's `commondir` name the main checkout, whose `.chemx/index.db` is the seed source.
 * Layouts are fabricated with plain fs, plus one made by git itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { locateParentIndex } from './index-seed-parent.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@localhost', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@localhost',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'
};

const tempDir = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-seed-parent-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// main/.git/worktrees/<name>/commondir -> ../.. ; <worktree>/.git -> gitdir: <main>/.git/worktrees/<name>
const fabricate = (base, { withDb = true, relativePointer = false } = {}) => {
  const main = path.join(base, 'main');
  const worktree = path.join(base, 'trees', 'wt');
  const gitDir = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  const pointer = relativePointer ? path.relative(worktree, gitDir) : gitDir;
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${pointer}\n`);
  if (withDb) {
    fs.mkdirSync(path.join(main, '.chemx'));
    fs.writeFileSync(path.join(main, '.chemx', 'index.db'), '');
  }
  return { main, worktree };
};

test('locateParentIndex: a linked worktree names the main checkout and its index db', (t) => {
  const { main, worktree } = fabricate(tempDir(t));
  const found = locateParentIndex(worktree);
  assert.equal(found.status, 'found');
  assert.equal(found.mainRoot, main);
  assert.equal(found.dbPath, path.join(main, '.chemx', 'index.db'));
});

test('locateParentIndex: a relative gitdir pointer resolves against the worktree root', (t) => {
  const { main, worktree } = fabricate(tempDir(t), { relativePointer: true });
  assert.equal(locateParentIndex(worktree).mainRoot, main);
});

test('locateParentIndex: a main checkout without an index is none, naming the checkout', (t) => {
  const { main, worktree } = fabricate(tempDir(t), { withDb: false });
  const none = locateParentIndex(worktree);
  assert.equal(none.status, 'none');
  assert.match(none.reason, /no index/);
  assert.ok(none.reason.includes(main));
});

test('locateParentIndex: the main checkout itself and a plain directory are none', (t) => {
  const base = tempDir(t);
  const { main } = fabricate(base);
  assert.equal(locateParentIndex(main).status, 'none');
  assert.match(locateParentIndex(main).reason, /not a linked worktree/);
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain);
  assert.equal(locateParentIndex(plain).status, 'none');
  assert.equal(locateParentIndex(':memory:').status, 'none');
});

test('locateParentIndex: a .git file without a gitdir pointer is none', (t) => {
  const base = tempDir(t);
  const odd = path.join(base, 'odd');
  fs.mkdirSync(odd);
  fs.writeFileSync(path.join(odd, '.git'), 'nothing here\n');
  const none = locateParentIndex(odd);
  assert.equal(none.status, 'none');
  assert.match(none.reason, /gitdir/);
});

test('locateParentIndex: without a commondir file the worktrees/<name> layout still names the main checkout', (t) => {
  const { main, worktree } = fabricate(tempDir(t));
  fs.rmSync(path.join(main, '.git', 'worktrees', 'wt', 'commondir'));
  assert.equal(locateParentIndex(worktree).mainRoot, main);
});

test('locateParentIndex: a worktree made by git itself', (t) => {
  const base = tempDir(t);
  const main = path.join(base, 'repo');
  fs.mkdirSync(main);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: main, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const worktree = path.join(base, 'wt');
  git('worktree', 'add', '-q', worktree);
  fs.mkdirSync(path.join(main, '.chemx'));
  fs.writeFileSync(path.join(main, '.chemx', 'index.db'), '');
  const found = locateParentIndex(worktree);
  assert.equal(found.status, 'found');
  assert.equal(fs.realpathSync(found.mainRoot), main);
});
