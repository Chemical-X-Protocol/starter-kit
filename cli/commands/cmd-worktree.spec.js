/**
 * `chemx worktree add|remove` (#6762, K17): a git worktree on a new branch with node_modules ready,
 * and its removal with the merged branch. Temp git repos with a local bare "origin"; no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWorktreeArgs, runWorktreeCommand } from './cmd-worktree.js';
import { installCommandFor } from '../worktree-modules.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@localhost', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@localhost',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'
};

const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

// A clone of a local bare origin with one commit on main, node_modules ignored, and a small node_modules.
const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wt-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin.git');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules\n.chemx/\n');
  fs.writeFileSync(path.join(main, 'package.json'), '{"name":"p"}\n');
  fs.writeFileSync(path.join(main, 'a.txt'), 'one\n');
  fs.mkdirSync(path.join(main, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(main, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  fs.mkdirSync(path.join(main, 'node_modules', '@scope', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(main, 'node_modules', '@scope', 'pkg', 'index.js'), 'module.exports = 2;\n');
  fs.mkdirSync(path.join(main, 'node_modules', '.bin'));
  fs.writeFileSync(path.join(main, 'node_modules', '.package-lock.json'), '{}');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'push', '-q', '-u', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');
  return { base, main, trees: path.join(base, 'trees') };
};

const capture = () => {
  const seen = { out: [], err: [] };
  return { seen, io: { out: (text) => seen.out.push(text), err: (text) => seen.err.push(text) } };
};

const run = (args, cwd, extra = {}) => {
  const { seen, io } = capture();
  return runWorktreeCommand(args, { cwd, env: { CHEMX_AGENT_ID: '@spec-a' }, ...io, ...extra }).then((code) => ({ code, out: seen.out.join(''), err: seen.err.join('') }));
};

test('parseWorktreeArgs: action, path and every flag in both forms', () => {
  const full = parseWorktreeArgs(['add', '../t/x', '-b', 'fix/x', '--from', 'origin/dev', '--link-modules', '--install']);
  assert.deepEqual(full, { action: 'add', target: '../t/x', branch: 'fix/x', from: 'origin/dev', linkModules: true, install: true, noSeedIndex: false, force: false, error: null });
  assert.equal(parseWorktreeArgs(['add', '../t/x', '-b', 'fix/x', '--no-seed-index']).noSeedIndex, true);
  const inline = parseWorktreeArgs(['add', '--branch=fix/y', '--from=origin/main', '../t/y']);
  assert.equal(inline.branch, 'fix/y');
  assert.equal(inline.from, 'origin/main');
  assert.equal(inline.target, '../t/y');
  assert.equal(parseWorktreeArgs(['remove', '../t/x', '--force']).force, true);
  assert.equal(parseWorktreeArgs(['add', '-b=z', 'p']).branch, 'z');
});

test('parseWorktreeArgs: usage errors', () => {
  assert.match(parseWorktreeArgs([]).error, /add or remove/);
  assert.match(parseWorktreeArgs(['move', 'x']).error, /add or remove/);
  assert.match(parseWorktreeArgs(['add', '-b', 'x']).error, /needs a path/);
  assert.match(parseWorktreeArgs(['add', 'p']).error, /-b <branch>/);
  assert.match(parseWorktreeArgs(['remove']).error, /needs a path/);
  assert.match(parseWorktreeArgs(['add', 'p', 'q', '-b', 'x']).error, /one path/);
  assert.match(parseWorktreeArgs(['add', 'p', '-b']).error, /-b needs/);
});

test('installCommandFor: the lockfile picks the package manager', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wt-pm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(installCommandFor(dir), null);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  assert.equal(installCommandFor(dir).command, 'npm');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  assert.equal(installCommandFor(dir).command, 'yarn');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  assert.equal(installCommandFor(dir).command, 'pnpm');
});

test('add: a worktree on a new branch from origin/main; the path is the first line, then the base and the board reminder', async (t) => {
  const { main, trees } = makeProject(t);
  const target = path.join(trees, 'fix-a');

  const result = await run(['add', target, '-b', 'fix/a'], main);

  assert.equal(result.code, 0, result.err);
  const lines = result.out.trim().split('\n');
  assert.equal(lines[0], target);
  assert.match(lines[1], /fix\/a.*origin\/main.*[0-9a-f]{7}/);
  assert.match(result.out, /board commands.*main checkout.*--board=/is);
  assert.ok(result.out.includes(main));
  assert.equal(git(target, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/a');
  assert.equal(git(target, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'origin/main'));
  assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
});

test('add --from: the branch starts at the given ref, not the default', async (t) => {
  const { main, trees } = makeProject(t);
  fs.writeFileSync(path.join(main, 'a.txt'), 'two\n');
  git(main, 'commit', '-q', '-am', 'second');
  const target = path.join(trees, 'from-head');

  const result = await run(['add', target, '-b', 'fix/h', '--from', 'main'], main);

  assert.equal(result.code, 0, result.err);
  assert.equal(git(target, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'));
  assert.notEqual(git(target, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'origin/main'));
});

test('add from inside another worktree still links the MAIN checkout\'s node_modules and names the main checkout', async (t) => {
  const { main, trees } = makeProject(t);
  const first = path.join(trees, 'first');
  await run(['add', first, '-b', 'fix/first'], main);
  const second = path.join(trees, 'second');

  const result = await run(['add', second, '-b', 'fix/second', '--link-modules'], first);

  assert.equal(result.code, 0, result.err);
  assert.equal(fs.realpathSync(path.join(second, 'node_modules', 'left-pad')), fs.realpathSync(path.join(main, 'node_modules', 'left-pad')));
  assert.ok(result.out.includes(main));
});

test('add --link-modules: a real node_modules of symlinks, so new packages never reach the main checkout', async (t) => {
  const { main, trees } = makeProject(t);
  const target = path.join(trees, 'linked');

  const result = await run(['add', target, '-b', 'fix/l', '--link-modules'], main);

  const modules = path.join(target, 'node_modules');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /node_modules linked \(\d+ entries\)/);
  assert.equal(fs.lstatSync(modules).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(path.join(modules, 'left-pad')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(modules, '@scope')).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(path.join(modules, '@scope', 'pkg')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(modules, '@scope', 'pkg', 'index.js'), 'utf8'), 'module.exports = 2;\n');
  assert.equal(fs.existsSync(path.join(modules, '.package-lock.json')), false);

  fs.mkdirSync(path.join(modules, 'brand-new'));
  fs.mkdirSync(path.join(modules, '@scope', 'also-new'));
  assert.equal(fs.existsSync(path.join(main, 'node_modules', 'brand-new')), false);
  assert.equal(fs.existsSync(path.join(main, 'node_modules', '@scope', 'also-new')), false);
});

test('add --link-modules with no node_modules in the main checkout says so and still succeeds', async (t) => {
  const { main, trees } = makeProject(t);
  fs.rmSync(path.join(main, 'node_modules'), { recursive: true });

  const result = await run(['add', path.join(trees, 'bare'), '-b', 'fix/b', '--link-modules'], main);

  assert.equal(result.code, 0, result.err);
  assert.match(result.out + result.err, /no node_modules in .*to link/);
});

test('add --install runs the lockfile\'s package manager in the new worktree; a failure is exit 1 with its tail', async (t) => {
  const { main, trees } = makeProject(t);
  fs.writeFileSync(path.join(main, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git(main, 'add', 'pnpm-lock.yaml');
  git(main, 'commit', '-q', '-m', 'lock');
  git(main, 'push', '-q');
  const calls = [];
  const okInstall = (command, cwd) => { calls.push({ command, cwd }); return { status: 0, output: 'done' }; };
  const target = path.join(trees, 'inst');

  const ok = await run(['add', target, '-b', 'fix/i', '--install'], main, { install: okInstall });

  assert.equal(ok.code, 0, ok.err);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.command, 'pnpm');
  assert.equal(calls[0].cwd, target);
  assert.match(ok.out, /installed with pnpm/);

  const failInstall = () => ({ status: 1, output: 'one\ntwo\nERR boom' });
  const bad = await run(['add', path.join(trees, 'inst2'), '-b', 'fix/i2', '--install'], main, { install: failInstall });

  assert.equal(bad.code, 1);
  assert.match(bad.err, /pnpm install failed.*ERR boom/s);
  assert.ok(fs.existsSync(path.join(trees, 'inst2')), 'the worktree stays; only the install failed');
});

test('add --link-modules --install links first, then installs what is missing', async (t) => {
  const { main, trees } = makeProject(t);
  const target = path.join(trees, 'both');
  let linkedWhenInstalling = null;
  const install = (command, cwd) => {
    linkedWhenInstalling = fs.existsSync(path.join(cwd, 'node_modules', 'left-pad'));
    return { status: 0, output: '' };
  };

  const result = await run(['add', target, '-b', 'fix/both', '--link-modules', '--install'], main, { install });

  assert.equal(result.code, 0, result.err);
  assert.equal(linkedWhenInstalling, true);
});

test('add refuses a missing -b (2), an unknown base (1) and an existing path (1) without leaving a branch behind', async (t) => {
  const { main, trees } = makeProject(t);
  fs.mkdirSync(path.join(trees, 'taken'), { recursive: true });
  fs.writeFileSync(path.join(trees, 'taken', 'f'), 'x');

  const noBranch = await run(['add', path.join(trees, 'x')], main);
  const badBase = await run(['add', path.join(trees, 'y'), '-b', 'fix/y', '--from', 'origin/nope'], main);
  const taken = await run(['add', path.join(trees, 'taken'), '-b', 'fix/t'], main);

  assert.equal(noBranch.code, 2);
  assert.equal(badBase.code, 1);
  assert.match(badBase.err, /origin\/nope/);
  assert.equal(taken.code, 1);
  assert.equal(git(main, 'branch', '--list', 'fix/t'), '');
});

const addWithCommit = async (project, name, file = 'new.txt') => {
  const target = path.join(project.trees, name);
  const branch = `fix/${name}`;
  const added = await run(['add', target, '-b', branch], project.main);
  assert.equal(added.code, 0, added.err);
  fs.writeFileSync(path.join(target, file), `${name}\n`);
  git(target, 'add', file);
  git(target, 'commit', '-q', '-m', `change ${name}`);
  return { target, branch };
};

test('remove: a worktree whose branch was merged is removed and so is the branch', async (t) => {
  const project = makeProject(t);
  const { target, branch } = await addWithCommit(project, 'merged');
  git(project.main, 'merge', '-q', '--ff-only', branch);
  git(project.main, 'push', '-q');

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(target), false);
  assert.equal(git(project.main, 'branch', '--list', branch), '');
  assert.match(result.out, /removed.*deleted branch fix\/merged.*merged into origin\/main/s);
});

test('remove: a squash-merged branch counts as merged (its commits are not ancestors of main)', async (t) => {
  const project = makeProject(t);
  const { target, branch } = await addWithCommit(project, 'squashed');
  git(project.main, 'merge', '--squash', branch);
  git(project.main, 'commit', '-q', '-m', 'squash of squashed');
  git(project.main, 'push', '-q');
  git(project.main, 'fetch', '-q');

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.equal(git(project.main, 'branch', '--list', branch), '');
  assert.match(result.out, /squash-merged/);
});

test('remove: an unmerged branch is refused and nothing is touched; --force removes both', async (t) => {
  const project = makeProject(t);
  const { target, branch } = await addWithCommit(project, 'unmerged');

  const refused = await run(['remove', target], project.main);

  assert.equal(refused.code, 1);
  assert.match(refused.err, /fix\/unmerged is not merged into origin\/main.*--force/s);
  assert.ok(fs.existsSync(target));
  assert.equal(git(project.main, 'branch', '--list', '--format=%(refname:short)', branch), branch);

  const forced = await run(['remove', target, '--force'], project.main);

  assert.equal(forced.code, 0, forced.err);
  assert.equal(fs.existsSync(target), false);
  assert.equal(git(project.main, 'branch', '--list', branch), '');
});

test('remove: a dirty worktree is refused unless --force', async (t) => {
  const project = makeProject(t);
  const target = path.join(project.trees, 'dirty');
  await run(['add', target, '-b', 'fix/dirty'], project.main);
  fs.writeFileSync(path.join(target, 'scrap.txt'), 'uncommitted\n');

  const refused = await run(['remove', target], project.main);

  assert.equal(refused.code, 1);
  assert.match(refused.err, /scrap|untracked|modified|--force/i);
  assert.ok(fs.existsSync(target));

  const forced = await run(['remove', target, '--force'], project.main);

  assert.equal(forced.code, 0, forced.err);
  assert.equal(fs.existsSync(target), false);
});

test('remove deletes a linked node_modules without touching the main checkout\'s packages', async (t) => {
  const project = makeProject(t);
  const target = path.join(project.trees, 'mods');
  await run(['add', target, '-b', 'fix/mods', '--link-modules'], project.main);

  const result = await run(['remove', target], project.main);

  assert.equal(result.code, 0, result.err);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(path.join(project.main, 'node_modules', 'left-pad', 'index.js'), 'utf8'), 'module.exports = 1;\n');
  assert.equal(fs.readFileSync(path.join(project.main, 'node_modules', '@scope', 'pkg', 'index.js'), 'utf8'), 'module.exports = 2;\n');
});

test('remove refuses the main checkout, a path git does not know, and the directory you stand in', async (t) => {
  const project = makeProject(t);
  const target = path.join(project.trees, 'here');
  await run(['add', target, '-b', 'fix/here'], project.main);

  const main = await run(['remove', project.main], project.main);
  const unknown = await run(['remove', path.join(project.base, 'nowhere')], project.main);
  const inside = await run(['remove', target], target);

  assert.equal(main.code, 1);
  assert.match(main.err, /main checkout/);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /not a worktree/);
  assert.equal(inside.code, 1);
  assert.match(inside.err, /standing in/);
  assert.ok(fs.existsSync(target));
});

test('CLI: chemx worktree add and remove through the router, exit codes included', async (t) => {
  const project = makeProject(t);
  const target = path.join(project.trees, 'cli');
  const env = { ...GIT_ENV, CHEMX_AGENT_ID: '@spec-a' };

  const added = spawnSync(process.execPath, [CLI, 'worktree', 'add', target, '-b', 'fix/cli', '--link-modules'], { cwd: project.main, env, encoding: 'utf8' });
  const help = spawnSync(process.execPath, [CLI, 'worktree', '--help'], { encoding: 'utf8' });
  const misuse = spawnSync(process.execPath, [CLI, 'worktree', 'add', target], { cwd: project.main, env, encoding: 'utf8' });
  const removed = spawnSync(process.execPath, [CLI, 'worktree', 'remove', target], { cwd: project.main, env, encoding: 'utf8' });

  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.stdout.split('\n')[0], target);
  assert.match(help.stdout, /chemx worktree add/);
  assert.equal(misuse.status, 2);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(target), false);
});
