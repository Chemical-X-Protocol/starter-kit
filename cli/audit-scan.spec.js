import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

process.env.CHEMX_TEST = '1';

import { scanTree } from './audit-scan.js';

const writeSource = (root, relPath) => {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'export const answer = 42;\n');
};

test('scanTree: skips package stores and agent worktree copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-scan-'));
  try {
    writeSource(root, 'src/app.ts');
    writeSource(root, '.pnpm-store/v11/files/00/pkg.js');
    writeSource(root, '.claude/worktrees/feature/src/app.ts');
    writeSource(root, '.chemx/cache/stale.js');
    writeSource(root, 'packages/ui/node_modules/dep/index.js');

    const { fileStats } = scanTree(root, root);
    const scanned = fileStats.map((stat) => stat.relativePath.split(path.sep).join('/'));

    assert.deepStrictEqual(scanned, ['src/app.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const withTempRoot = (fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-git-')));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const scannedPaths = (root) => scanTree(root, root).fileStats.map((stat) => stat.relativePath.split(path.sep).join('/')).sort();

test('scanTree: a gitignored tree is not audited in a git repo', () => {
  withTempRoot((root) => {
    execSync('git init -q', { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'scratch/\n');
    writeSource(root, 'src/app.ts');
    writeSource(root, 'scratch/violator.ts');
    assert.deepStrictEqual(scannedPaths(root), ['src/app.ts']);
  });
});

test('scanTree: untracked, non-ignored files in a git repo are still audited', () => {
  withTempRoot((root) => {
    execSync('git init -q', { cwd: root });
    writeSource(root, 'src/a.ts');
    writeSource(root, 'lib/b.ts');
    assert.deepStrictEqual(scannedPaths(root), ['lib/b.ts', 'src/a.ts']);
  });
});

test('scanTree: a non-git directory still walks, ignoring only the fixed skip list', () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'scratch/\n');
    writeSource(root, 'src/app.ts');
    writeSource(root, 'scratch/kept.ts');
    writeSource(root, 'node_modules/dep/index.js');
    assert.deepStrictEqual(scannedPaths(root), ['scratch/kept.ts', 'src/app.ts']);
  });
});

test('scanTree: git-listed files in skip-list dirs are still dropped', () => {
  withTempRoot((root) => {
    execSync('git init -q', { cwd: root });
    writeSource(root, 'src/app.ts');
    writeSource(root, 'packages/ui/node_modules/dep/index.js');
    writeSource(root, '.claude/worktrees/f/src/app.ts');
    assert.deepStrictEqual(scannedPaths(root), ['src/app.ts']);
  });
});

test('scanTree: an explicitly targeted gitignored directory is still audited', () => {
  withTempRoot((root) => {
    execSync('git init -q', { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n');
    writeSource(root, 'generated/x/b.ts');
    const target = path.join(root, 'generated');
    const scanned = scanTree(target, root).fileStats.map((stat) => stat.relativePath.split(path.sep).join('/'));
    assert.deepStrictEqual(scanned, ['generated/x/b.ts']);
  });
});
