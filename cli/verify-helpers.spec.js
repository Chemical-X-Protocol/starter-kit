// checkNodeModules names the fix: install, or in a git worktree link the main checkout's node_modules (task #6754).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkNodeModules } from './verify-helpers.js';

// A main checkout (with or without node_modules) and a linked worktree of it.
const withWorktree = (body, { mainHasModules = true } = {}) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wt-'));
  const main = path.join(base, 'main');
  const worktree = path.join(base, 'wt');
  try {
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    if (mainHasModules) fs.mkdirSync(path.join(main, 'node_modules'));
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, 'package.json'), '{"packageManager":"pnpm@9.0.0"}');
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
    return body({ main, worktree });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
};

test('checkNodeModules: null when node_modules exists', () => {
  withWorktree(({ worktree }) => {
    fs.mkdirSync(path.join(worktree, 'node_modules'));
    assert.equal(checkNodeModules(worktree), null);
  });
});

test('checkNodeModules: a plain project is told to install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-nm-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"packageManager":"pnpm@9.0.0"}');
    assert.equal(checkNodeModules(dir).msg('testing'), "Missing node_modules. Please run 'pnpm install' before testing.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkNodeModules: a worktree is also told the symlink to the main checkout, in one line', () => {
  withWorktree(({ main, worktree }) => {
    const message = checkNodeModules(worktree).msg('testing');
    assert.match(message, /^Missing node_modules\. Please run 'pnpm install' before testing\./);
    assert.ok(message.includes(`ln -s ${path.join(main, 'node_modules')} ${path.join(worktree, 'node_modules')}`), message);
    assert.equal(message.includes('\n'), false);
  });
});

test('checkNodeModules: a worktree whose main checkout has no node_modules gets the plain install message', () => {
  withWorktree(({ worktree }) => {
    assert.equal(checkNodeModules(worktree).msg('testing'), "Missing node_modules. Please run 'pnpm install' before testing.");
  }, { mainHasModules: false });
});

test('checkNodeModules: a submodule (a .git file that is not a worktree) is not mistaken for a worktree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sub-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ../.git/modules/sub\n');
    assert.doesNotMatch(checkNodeModules(dir).msg('testing'), /ln -s/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
