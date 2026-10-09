import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleChemxRead } from './mcp/tools-read.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });
const run = (cwd, args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

const OLD = 'export const oldOne = 1;\nexport function oldFn() {\n  return oldOne;\n}\n';
const NEW = 'export const newOne = 2;\n';

/** Two commits: src/a.ts holds OLD at HEAD~1 and NEW at HEAD; HEAD also adds a 120-line file. */
const withRepo = (fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-rev-')));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'dev@example.test');
    git(dir, 'config', 'user.name', 'Dev Person');
    write(dir, 'src/a.ts', OLD);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'first: add oldFn', '-m', 'Body line explaining why.');
    write(dir, 'src/a.ts', NEW);
    write(dir, 'src/big.ts', Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'second: replace and add big');
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('read <rev>:<path>: numbered lines from the revision, not the working tree', () => {
  withRepo((dir) => {
    const res = run(dir, ['read', 'HEAD~1:src/a.ts']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /HEAD~1:src\/a\.ts/);
    assert.match(res.stdout, /1\|export const oldOne = 1;/);
    assert.doesNotMatch(res.stdout, /newOne/);
  });
});

test('read <rev>:<path>: --outline, --symbol, --start/--end and :N-M work at a revision', () => {
  withRepo((dir) => {
    assert.match(run(dir, ['read', 'HEAD~1:src/a.ts', '--outline']).stdout, /oldFn/);
    const sym = run(dir, ['read', 'HEAD~1:src/a.ts', '--symbol=oldFn']);
    assert.equal(sym.status, 0, sym.stderr);
    assert.match(sym.stdout, /return oldOne;/);
    const range = run(dir, ['read', 'HEAD~1:src/a.ts', '--start=2', '--end=2']);
    assert.match(range.stdout, /2\|export function oldFn\(\) \{/);
    assert.doesNotMatch(range.stdout, /1\|/);
    assert.match(run(dir, ['read', 'HEAD~1:src/a.ts:3-3']).stdout, /3\| {2}return oldOne;/);
  });
});

test('read: path:N-M on a working file still means lines, and a bad revision is named', () => {
  withRepo((dir) => {
    assert.match(run(dir, ['read', 'src/a.ts:1-1']).stdout, /1\|export const newOne = 2;/);
    const missing = run(dir, ['read', 'nosuchrev:src/a.ts']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /nosuchrev/);
    const absent = run(dir, ['read', 'HEAD~1:src/big.ts']);
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /src\/big\.ts.*HEAD~1|HEAD~1.*src\/big\.ts/);
  });
});

test('show <sha>: subject, author, date, body and stat; --patch is -U0', () => {
  withRepo((dir) => {
    const res = run(dir, ['show', 'HEAD~1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /first: add oldFn/);
    assert.match(res.stdout, /Dev Person <dev@example\.test>/);
    assert.match(res.stdout, /\d{4}-\d{2}-\d{2}/);
    assert.match(res.stdout, /Body line explaining why\./);
    assert.match(res.stdout, /src\/a\.ts \| 4 \+{4}/);
    assert.doesNotMatch(res.stdout, /^@@/m);
    const patch = run(dir, ['show', 'HEAD~1', '--patch']);
    assert.match(patch.stdout, /^@@ -0,0 \+1,4 @@/m);
    assert.match(patch.stdout, /^\+export function oldFn\(\) \{/m);
  });
});

test('show --patch collapses past the diff budget unless --full', () => {
  withRepo((dir) => {
    const collapsed = run(dir, ['show', 'HEAD', '--patch']);
    assert.equal(collapsed.status, 0, collapsed.stderr);
    assert.match(collapsed.stdout, /Use chemx show HEAD --patch --full/);
    assert.doesNotMatch(collapsed.stdout, /v119 = 119/);
    assert.match(run(dir, ['show', 'HEAD', '--patch', '--full']).stdout, /\+export const v119 = 119;/);
    assert.equal(run(dir, ['show', 'nosuchrev']).status, 128);
  });
});

test('MCP parity: read { path, rev } and show action', async () => {
  const { ACTION_NAMES } = await import('./mcp/tools.js');
  withRepo((dir) => {
    const text = handleChemxRead({ path: 'src/a.ts', rev: 'HEAD~1', symbol: 'oldFn' }, dir);
    assert.match(text, /return oldOne;/);
    assert.throws(() => handleChemxRead({ path: '../x.ts', rev: 'HEAD~1' }, dir));
    assert.throws(() => handleChemxRead({ path: 'src/a.ts', rev: '--output=x' }, dir), /revision/);
  });
  assert.ok(ACTION_NAMES.includes('show'), 'MCP has a show action');
});
