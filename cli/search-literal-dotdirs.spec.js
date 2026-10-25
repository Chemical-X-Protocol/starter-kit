import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLiteralSearch, isRipgrepAvailable } from './search-literal.js';
import { handleLiteralSearchCommand } from './search-commands.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const ENGINES = isRipgrepAvailable() ? ['js', 'rg'] : ['js'];
const NEEDLE = 'CHEMX_VERSION_PIN';

const git = (cwd, args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

const write = (root, rel, content = `${NEEDLE}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

// A repo the way a project really looks: tracked dot-directories (.github, .claude), a tracked dotfile,
// an untracked dot-directory that git does not ignore, ignored paths, the chemx index dir, a worktree copy,
// the git store and an (unignored) node_modules.
const makeRepo = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dotdirs-')));
  git(root, ['init', '-q']);
  write(root, '.gitignore', '.cache/\nignored/\n');
  for (const rel of ['src/a.js', '.github/workflows/ci.yml', '.claude/settings.json', '.chemxrc']) write(root, rel);
  git(root, ['add', '.']);
  for (const rel of ['.fresh/new.yml', '.cache/c.txt', 'ignored/z.txt', '.chemx/note.txt', '.claude/worktrees/copy/src/a.js']) write(root, rel);
  for (const rel of ['.git/hooks/pre-commit.sample', 'node_modules/pkg/index.js']) write(root, rel);
  return root;
};

const withRepo = (body) => {
  const root = makeRepo();
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const found = (res) => res.files.slice().sort();

for (const engine of ENGINES) {
  test(`q -g (${engine}): tracked and untracked dot-directories are searched by default, ignored paths and tool trees are not`, () => withRepo((root) => {
    const res = runLiteralSearch({ root, pattern: NEEDLE, engine });
    assert.deepEqual(found(res), ['.chemxrc', '.claude/settings.json', '.fresh/new.yml', '.github/workflows/ci.yml', 'src/a.js']);
    assert.equal(res.skipped.hidden, true, 'the result still says ignored paths were left out');
  }));

  test(`q -g (${engine}): --hidden also searches what git ignores, the chemx index dir and worktree copies, never .git or node_modules`, () => withRepo((root) => {
    const res = runLiteralSearch({ root, pattern: NEEDLE, engine, isHidden: true });
    assert.deepEqual(found(res), [
      '.cache/c.txt', '.chemx/note.txt', '.chemxrc', '.claude/settings.json', '.claude/worktrees/copy/src/a.js',
      '.fresh/new.yml', '.github/workflows/ci.yml', 'ignored/z.txt', 'src/a.js'
    ]);
    assert.equal(res.skipped.hidden, false);
  }));
}

test('q -g: a non-git tree searches .github and other dot-directories too, and still skips generated dirs', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dotdirs-walk-')));
  try {
    for (const rel of ['.github/workflows/ci.yml', 'src/a.js', 'node_modules/x/i.js', '.cache/c.txt']) write(root, rel);
    const res = handleLiteralSearchCommand(null, NEEDLE, { isCli: false, isQuiet: true, cwd: root, engine: 'js' });
    assert.deepEqual(res.matches.map((m) => m.path).sort(), ['.github/workflows/ci.yml', 'src/a.js']);
    const all = handleLiteralSearchCommand(null, NEEDLE, { isCli: false, isQuiet: true, cwd: root, engine: 'js', isHidden: true });
    assert.deepEqual(all.matches.map((m) => m.path).sort(), ['.cache/c.txt', '.github/workflows/ci.yml', 'src/a.js'], '--hidden brings back .cache, never node_modules');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const runQ = (cwd, args) => new Promise((resolve) => {
  execFile(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd, env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '', CHEMX_LITERAL_ENGINE: 'js' } }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr });
  });
});

test('q -g CLI: finds the CI pin in .github/workflows and the header names what was left out', async () => {
  const root = makeRepo();
  try {
    const res = await runQ(root, ['-g', NEEDLE, '-l']);
    assert.deepEqual(res.stdout.split('\n').filter(Boolean), ['.chemxrc', '.claude/settings.json', '.fresh/new.yml', '.github/workflows/ci.yml', 'src/a.js']);
    const report = await runQ(root, ['-g', NEEDLE]);
    assert.match(report.stdout, /dot-directories searched; git-ignored paths skipped \(--hidden includes them\)/);
    const hidden = await runQ(root, ['-g', NEEDLE, '--hidden']);
    assert.match(hidden.stdout, /git-ignored paths included/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('q <symbol> with no symbol hit: the fixed-string fallback reaches .github too', async () => {
  const root = makeRepo();
  try {
    const res = await runQ(root, [NEEDLE, '--json']);
    const payload = JSON.parse(res.stdout.trim().split('\n').pop());
    const paths = payload.literal.matches.map((m) => m.path);
    assert.ok(paths.includes('.github/workflows/ci.yml'), JSON.stringify(paths));
    assert.ok(!paths.some((p) => p.startsWith('.claude/worktrees/') || p.startsWith('ignored/')), JSON.stringify(paths));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
