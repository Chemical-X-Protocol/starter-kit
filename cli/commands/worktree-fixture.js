/**
 * Shared fixture of the `chemx worktree` specs (#6762, K17; #6777, K24): a clone of a local bare "origin"
 * with one commit on main and a small node_modules, plus the runner that captures the command's output.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runWorktreeCommand } from './cmd-worktree.js';

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@localhost', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@localhost',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'
};

export const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

// A clone of a local bare origin with one commit on main, node_modules ignored, and a small node_modules.
export const makeProject = (t) => {
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

export const run = (args, cwd, extra = {}) => {
  const { seen, io } = capture();
  return runWorktreeCommand(args, { cwd, env: { CHEMX_AGENT_ID: '@spec-a' }, ...io, ...extra }).then((code) => ({ code, out: seen.out.join(''), err: seen.err.join('') }));
};

export const addWithCommit = async (project, name, file = 'new.txt') => {
  const target = path.join(project.trees, name);
  const branch = `fix/${name}`;
  const added = await run(['add', target, '-b', branch], project.main);
  assert.equal(added.code, 0, added.err);
  fs.writeFileSync(path.join(target, file), `${name}\n`);
  git(target, 'add', file);
  git(target, 'commit', '-q', '-m', `change ${name}`);
  return { target, branch };
};
