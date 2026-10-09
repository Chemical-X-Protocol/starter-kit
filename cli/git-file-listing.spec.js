import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { listGitFiles } from './git-file-listing.js';

const withTempDir = (fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-git-listing-')));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const write = (root, rel) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), 'x\n');
};

test('listGitFiles: returns null outside a git repo', () => {
  withTempDir((root) => {
    write(root, 'a.js');
    assert.strictEqual(listGitFiles(root), null);
  });
});

test('listGitFiles: honours .gitignore and drops .claude / .chemx trees', () => {
  withTempDir((root) => {
    execSync('git init -q', { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'scratch/\n');
    for (const rel of ['src/a.js', 'scratch/b.js', '.claude/w/c.js', '.chemx/d.js']) write(root, rel);
    assert.deepStrictEqual(listGitFiles(root).sort(), ['.gitignore', 'src/a.js']);
  });
});

test('listGitFiles: includeIgnored opts in to ignored paths', () => {
  withTempDir((root) => {
    execSync('git init -q', { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'scratch/\n');
    write(root, 'scratch/b.js');
    assert.ok(listGitFiles(root, { includeIgnored: true }).includes('scratch/b.js'));
  });
});

test('listGitFiles: recurses into nested repos', () => {
  withTempDir((root) => {
    execSync('git init -q', { cwd: root });
    write(root, 'inner/x.js');
    execSync('git init -q', { cwd: path.join(root, 'inner') });
    assert.ok(listGitFiles(root).includes('inner/x.js'));
  });
});

test('listGitFiles: skips symlinks to directories so aliased source is not double-counted', () => {
  withTempDir((root) => {
    execSync('git init -q', { cwd: root });
    write(root, 'src/lib/a.js');
    fs.symlinkSync('lib', path.join(root, 'src/alias'));
    fs.symlinkSync('..', path.join(root, 'src/up'));
    assert.deepStrictEqual(listGitFiles(root), ['src/lib/a.js']);
  });
});
