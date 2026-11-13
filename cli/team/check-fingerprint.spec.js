import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStatusZ, treeFingerprint } from './check-fingerprint.js';

const IDENTITY = ['-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always'];
const git = (cwd, ...args) => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const scratch = () => mkdtempSync(join(tmpdir(), 'chemx-fp-'));

const makeRepo = (dir) => {
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
};

// File mtimes have millisecond resolution: edit with a different size so a fast spec never races it.
const edit = (path, text) => writeFileSync(path, text);

test('fingerprint: parseStatusZ reads a rename as the new path plus its origin, not a mangled slice', () => {
  const entries = parseStatusZ('R  new name.txt\0old name.txt\0?? x.txt\0 M y.txt\0');
  assert.deepEqual(entries, [
    { code: 'R ', path: 'new name.txt' },
    { code: 'origin', path: 'old name.txt' },
    { code: '??', path: 'x.txt' },
    { code: ' M', path: 'y.txt' }
  ]);
  assert.deepEqual(parseStatusZ(''), []);
});

test('fingerprint: it is empty outside a git repo and for a missing directory', () => {
  const dir = scratch();
  try {
    assert.equal(treeFingerprint(join(dir, 'nope')), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint: an edit to an already-dirty file changes it, from the repo root and from a subdirectory alike', () => {
  const root = makeRepo(scratch());
  try {
    mkdirSync(join(root, 'sub'));
    const file = join(root, 'sub', 'f.txt');
    edit(file, 'one');
    const fromRoot = treeFingerprint(root);
    const fromSub = treeFingerprint(join(root, 'sub'));
    assert.notEqual(fromRoot, '');
    assert.equal(fromSub, fromRoot);
    edit(file, 'two-longer');
    assert.notEqual(treeFingerprint(join(root, 'sub')), fromSub);
    assert.notEqual(treeFingerprint(root), fromRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fingerprint: a staged rename is fingerprinted, and editing the renamed file changes it', () => {
  const root = makeRepo(scratch());
  try {
    git(root, 'mv', 'a.txt', 'renamed.txt');
    const renamed = treeFingerprint(root);
    edit(join(root, 'renamed.txt'), 'changed content');
    assert.notEqual(treeFingerprint(root), renamed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fingerprint: a dirty submodule shows in the deep fingerprint, and a new submodule commit in the shallow one', () => {
  const upstream = makeRepo(scratch());
  const root = makeRepo(scratch());
  try {
    git(root, 'submodule', 'add', '-q', upstream, 'mod');
    git(root, 'commit', '-q', '-m', 'add submodule');
    const shallowBefore = treeFingerprint(root);
    const deepBefore = treeFingerprint(root, { deep: true });
    edit(join(root, 'mod', 'a.txt'), 'edited inside the submodule');
    assert.equal(treeFingerprint(root), shallowBefore);
    const deepDirty = treeFingerprint(root, { deep: true });
    assert.notEqual(deepDirty, deepBefore);
    git(join(root, 'mod'), 'commit', '-q', '-am', 'move the submodule');
    assert.notEqual(treeFingerprint(root), shallowBefore);
    assert.notEqual(treeFingerprint(root, { deep: true }), deepDirty);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(upstream, { recursive: true, force: true });
  }
});

test('fingerprint: the shallow one is cheap enough for the enqueue path', () => {
  const root = makeRepo(scratch());
  try {
    treeFingerprint(root);
    const started = Date.now();
    treeFingerprint(root);
    assert.ok(Date.now() - started < 500);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
