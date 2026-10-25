/**
 * End to end (#6769, K8b): a real parent repo with an index, a real `git worktree add`, one file edited in
 * the worktree. The lazy path (first `chemx q` in the worktree) and the eager path (`chemx worktree add`)
 * both start from the parent's rows and parse only what differs; `--no-seed-index` leaves no index behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clearDbCache, openIndexDb, findSymbolDefinition } from './search-db.js';
import { syncSearchIndex } from './search-sync.js';
import { runWorktreeCommand } from './commands/cmd-worktree.js';

delete process.env.CHEMX_PROJECT_ROOT;

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const CHILD_ENV = { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '', CHEMX_AGENT_ID: '@spec-seed' };
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

const FILES = {
  'src/h.js': 'export const helper = () => 1;\n',
  'src/a.js': "import { helper } from './h.js';\nexport const alpha = () => helper();\n",
  'src/b.js': 'export const beta = () => 2;\n'
};

// A git repo on main with FILES committed and indexed; worktrees go under <base>/trees.
const makeParent = (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-seed-e2e-')));
  t.after(() => { clearDbCache(); fs.rmSync(base, { recursive: true, force: true }); });
  const parent = path.join(base, 'parent');
  fs.mkdirSync(parent);
  git(parent, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(parent, '.gitignore'), '.chemx/\nnode_modules\n');
  fs.writeFileSync(path.join(parent, 'package.json'), '{"name":"seed-e2e"}\n');
  for (const [rel, content] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(parent, rel)), { recursive: true });
    fs.writeFileSync(path.join(parent, rel), content);
  }
  git(parent, 'add', '.');
  git(parent, 'commit', '-q', '-m', 'init');
  const indexed = syncSearchIndex('.', parent);
  assert.equal(indexed.updatedCount, 3, 'the parent index holds the three files');
  return { base, parent, trees: path.join(base, 'trees') };
};

const runQ = (cwd, ...args) => spawnSync(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd, encoding: 'utf-8', env: CHILD_ENV });

test('lazy: the first q in a plain git worktree seeds from the parent, parses the edited file and finds its new symbol', (t) => {
  const { parent, trees } = makeParent(t);
  const worktree = path.join(trees, 'lazy');
  git(parent, 'worktree', 'add', '-q', '--detach', worktree, 'HEAD');
  fs.writeFileSync(path.join(worktree, 'src', 'b.js'), 'export const beta = () => 2;\nexport const seededFresh = () => 3;\n');

  const first = runQ(worktree, 'seededFresh');

  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /src\/b\.js/);
  assert.match(first.stdout, /synced 3 files, 1 re-indexed, 0 removed/);
  assert.match(first.stdout, new RegExp(`seeded 2 of 3 files from ${parent.replaceAll('/', '\\/')}`));
  const second = runQ(worktree, 'alpha');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /src\/a\.js/);
  assert.match(second.stdout, /0 re-indexed/);
  assert.doesNotMatch(second.stdout, /seeded/, 'the seed happens once');
  assert.ok(fs.existsSync(path.join(parent, '.chemx', 'index.db')), 'the parent keeps its db');
});

test('eager: chemx worktree add seeds the new worktree and says so; its first sync parses nothing', async (t) => {
  const { parent, trees } = makeParent(t);
  const worktree = path.join(trees, 'eager');
  const out = [];

  const code = await runWorktreeCommand(['add', worktree, '-b', 'fix/seed'], { cwd: parent, env: CHILD_ENV, out: (text) => out.push(text), err: (text) => out.push(text) });

  const text = out.join('');
  assert.equal(code, 0, text);
  const lines = text.trim().split('\n');
  assert.equal(lines[0], worktree);
  assert.match(text, new RegExp(`^index: seeded 3 of 3 files from ${parent.replaceAll('/', '\\/')} \\(\\d+ms\\)$`, 'm'));
  assert.ok(lines.indexOf(lines.find((line) => line.startsWith('index:'))) < lines.length - 1, 'the board reminder stays last');
  const db = openIndexDb(worktree);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM files').get().c, 3);
  assert.equal(db.prepare('SELECT root_path FROM project_stamp').get().root_path, worktree);
  const synced = syncSearchIndex('.', worktree);
  assert.equal(synced.updatedCount, 0);
  assert.equal(synced.seed, null);
  assert.equal(findSymbolDefinition(db, 'alpha').filePath, 'src/a.js');
  assert.equal(git(worktree, 'status', '--porcelain'), '', 'the worktree is clean: .chemx is ignored');
});

test('eager --no-seed-index: no index line and no index db in the worktree', async (t) => {
  const { parent, trees } = makeParent(t);
  const worktree = path.join(trees, 'unseeded');
  const out = [];

  const code = await runWorktreeCommand(['add', worktree, '-b', 'fix/unseeded', '--no-seed-index'], { cwd: parent, env: CHILD_ENV, out: (text) => out.push(text), err: (text) => out.push(text) });

  assert.equal(code, 0, out.join(''));
  assert.doesNotMatch(out.join(''), /^index:/m);
  assert.equal(fs.existsSync(path.join(worktree, '.chemx')), false);
});

test('eager with a parent that has no index: nothing is said about seeding', async (t) => {
  const { parent, trees } = makeParent(t);
  openIndexDb(parent).close();
  clearDbCache();
  fs.rmSync(path.join(parent, '.chemx'), { recursive: true, force: true });
  const out = [];

  const code = await runWorktreeCommand(['add', path.join(trees, 'quiet'), '-b', 'fix/quiet'], { cwd: parent, env: CHILD_ENV, out: (text) => out.push(text), err: (text) => out.push(text) });

  assert.equal(code, 0, out.join(''));
  assert.doesNotMatch(out.join(''), /^index:/m);
  assert.doesNotMatch(out.join(''), /seeded|skipped/);
});
