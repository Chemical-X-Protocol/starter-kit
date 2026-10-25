/**
 * Per-agent scratch space (#6762, K17): .chemx/scratch/<handle>/ in the project root, gitignored,
 * created on demand. Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scratchHandleName, scratchPathFor, ensureScratchDir } from './scratch-dir.js';

const makeRepo = (t, { gitignore } = {}) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scratch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const hasGitignore = gitignore !== undefined;
  if (hasGitignore) fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
  return root;
};

const gitSays = (root, file) => spawnSync('git', ['check-ignore', '-q', file], { cwd: root }).status;

test('scratchHandleName: the @ goes, anything unsafe in a directory name becomes a dash, no handle is _shared', () => {
  assert.equal(scratchHandleName('@sonnet-k17'), 'sonnet-k17');
  assert.equal(scratchHandleName('@claude-1a2b3c4d'), 'claude-1a2b3c4d');
  assert.equal(scratchHandleName('@we ird/..name'), 'we-ird-..name');
  assert.equal(scratchHandleName('@..'), '_shared');
  assert.equal(scratchHandleName(null), '_shared');
  assert.equal(scratchHandleName(''), '_shared');
});

test('scratchPathFor: a name stays inside the handle directory; an escape is refused', () => {
  const dir = path.join(os.tmpdir(), 'chemx-scratch-x', 'me');
  assert.equal(scratchPathFor(dir, 'one.mjs'), path.join(dir, 'one.mjs'));
  assert.equal(scratchPathFor(dir, 'sub/two.mjs'), path.join(dir, 'sub', 'two.mjs'));
  assert.throws(() => scratchPathFor(dir, '../other/one.mjs'), /inside/);
  assert.throws(() => scratchPathFor(dir, '/etc/passwd'), /inside/);
  assert.throws(() => scratchPathFor(dir, 'a/../../b'), /inside/);
  assert.throws(() => scratchPathFor(dir, ''), /name/);
});

test('ensureScratchDir creates .chemx/scratch/<handle>/ under the project root, from a subdirectory too', (t) => {
  const root = makeRepo(t);
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });

  const first = ensureScratchDir(path.join(root, 'src', 'deep'), '@sonnet-k17');
  const second = ensureScratchDir(root, '@sonnet-k17');

  assert.equal(first.dir, path.join(root, '.chemx', 'scratch', 'sonnet-k17'));
  assert.equal(second.dir, first.dir);
  assert.ok(fs.statSync(first.dir).isDirectory());
});

test('two handles never share a directory', (t) => {
  const root = makeRepo(t);

  const a = ensureScratchDir(root, '@sonnet-k17');
  const b = ensureScratchDir(root, '@antigravity-k7');
  fs.writeFileSync(path.join(a.dir, 'one.mjs'), 'a');

  assert.notEqual(a.dir, b.dir);
  assert.equal(fs.existsSync(path.join(b.dir, 'one.mjs')), false);
});

test('a fresh repo gets the scratch directory git-ignored', (t) => {
  const root = makeRepo(t);

  const { dir } = ensureScratchDir(root, '@a');
  fs.writeFileSync(path.join(dir, 'x.mjs'), 'x');

  assert.equal(gitSays(root, '.chemx/scratch/a/x.mjs'), 0);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.includes('.chemx'), false);
});

test('a .gitignore that lists only part of .chemx is extended with .chemx/scratch/', (t) => {
  const root = makeRepo(t, { gitignore: 'node_modules\n.chemx/index.db\n' });

  const { dir, ignoreAdded } = ensureScratchDir(root, '@a');
  fs.writeFileSync(path.join(dir, 'x.mjs'), 'x');

  assert.equal(ignoreAdded, true);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.chemx\/scratch\/$/m);
  assert.equal(gitSays(root, '.chemx/scratch/a/x.mjs'), 0);
});

test('a .gitignore that already covers .chemx/ is left alone, and so is a second call', (t) => {
  const root = makeRepo(t, { gitignore: '# mine\n.chemx/\n' });
  const before = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  const first = ensureScratchDir(root, '@a');
  const second = ensureScratchDir(root, '@a');

  assert.equal(first.ignoreAdded, false);
  assert.equal(second.ignoreAdded, false);
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), before);
});

test('git is the judge: a parent .gitignore that covers .chemx leaves a package inside a monorepo alone', (t) => {
  const root = makeRepo(t, { gitignore: '.chemx/\n' });
  const pkg = path.join(root, 'packages', 'a');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{}');

  const { dir, ignoreAdded } = ensureScratchDir(pkg, '@a');

  assert.equal(dir, path.join(pkg, '.chemx', 'scratch', 'a'));
  assert.equal(ignoreAdded, false);
  assert.equal(fs.existsSync(path.join(pkg, '.gitignore')), false);
});

test('a comment or a negation does not count as ignoring: .chemx/ is re-included, so .chemx/scratch/ is added', (t) => {
  const root = makeRepo(t, { gitignore: '# .chemx/\n.chemx/*\n!.chemx/scratch\n' });

  const { dir, ignoreAdded } = ensureScratchDir(root, '@a');
  fs.writeFileSync(path.join(dir, 'x.mjs'), 'x');

  assert.equal(ignoreAdded, true);
  assert.equal(gitSays(root, '.chemx/scratch/a/x.mjs'), 0);
});

test('outside a git repo the directory is still created and no .gitignore is invented', (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scratch-nogit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');

  const { dir, ignoreAdded } = ensureScratchDir(root, '@a');

  assert.ok(fs.statSync(dir).isDirectory());
  assert.equal(ignoreAdded, false);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});
