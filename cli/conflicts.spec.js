import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(CLI_DIR, 'index.js');
// Markers are built, never written at column 0, so this spec is never itself "unmerged".
const OURS = '<'.repeat(7);
const MID = '='.repeat(7);
const THEIRS = '>'.repeat(7);

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });
const run = (cwd, args, cli = CLI) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8' });
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const body = (n) => `export const a = ${n};\nexport function f() {\n  return a;\n}\n`;

/** A repo stopped mid-merge with one content conflict in src/a.ts (HEAD: 3, side: 2). */
const makeMidMerge = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-conflicts-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  write(dir, 'src/a.ts', body(1));
  write(dir, 'src/ok.ts', 'export const ok = true;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'side');
  write(dir, 'src/a.ts', body(2));
  git(dir, 'commit', '-qam', 'side');
  git(dir, 'checkout', '-q', 'main');
  write(dir, 'src/a.ts', body(3));
  git(dir, 'commit', '-qam', 'main');
  git(dir, 'merge', '-q', 'side');
  return dir;
};
const withMerge = (fn) => {
  const dir = makeMidMerge();
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('conflicts: lists unmerged paths with both sides of each hunk', () => {
  withMerge((dir) => {
    const res = run(dir, ['conflicts']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /src\/a\.ts/);
    assert.match(res.stdout, /L1-5/);
    assert.match(res.stdout, /ours \(HEAD\)[\s\S]*export const a = 3;/);
    assert.match(res.stdout, /theirs \(side\)[\s\S]*export const a = 2;/);
    assert.doesNotMatch(res.stdout, /ok\.ts/);
  });
});

test('conflicts --json: machine-readable hunks', () => {
  withMerge((dir) => {
    const parsed = JSON.parse(run(dir, ['conflicts', '--json']).stdout);
    assert.equal(parsed.unmerged.length, 1);
    const [file] = parsed.unmerged;
    assert.equal(file.path, 'src/a.ts');
    assert.deepEqual(file.hunks[0], { start: 1, end: 5, oursLabel: 'HEAD', theirsLabel: 'side', ours: ['export const a = 3;'], theirs: ['export const a = 2;'], base: null });
  });
});

test('conflicts: a clean repo says so and exits 0', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-conflicts-clean-')));
  try {
    git(dir, 'init', '-q');
    const res = run(dir, ['conflicts']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /No unmerged paths/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('d --conflicts: combined diff of unmerged files only', () => {
  withMerge((dir) => {
    write(dir, 'src/ok.ts', 'export const ok = false;\n');
    const res = run(dir, ['d', '--conflicts']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /diff --cc src\/a\.ts/);
    assert.doesNotMatch(res.stdout, /ok\.ts/);
  });
});

test('read/check/audit/q: a conflicted file gets a one-line note instead of AST output', () => {
  withMerge((dir) => {
    const outline = run(dir, ['read', 'src/a.ts', '--outline']);
    assert.match(outline.stdout + outline.stderr, /unmerged conflict markers at L1 \(HEAD \| side\)/);
    assert.match(outline.stdout, /1\|/);
    const check = run(dir, ['check', 'src/a.ts']);
    assert.match(check.stdout + check.stderr, /unmerged conflict markers at L1/);
    assert.doesNotMatch(check.stdout, /SYNTAX_PARSE_ERROR/);
    const audit = run(dir, ['audit', 'src']);
    assert.match(audit.stdout + audit.stderr, /skipped 1 file with unmerged conflict markers: src\/a\.ts:1/);
    const q = run(dir, ['q', 'f']);
    assert.match(q.stdout + q.stderr, /skipped 1 file with unmerged conflict markers: src\/a\.ts:1/);
  });
});

test('SEARCH/REPLACE blocks and indented markers are not conflicts', async () => {
  const { findConflictHunks } = await import('./conflicts.js');
  const blocks = [`${OURS} SEARCH`, 'a', MID, 'b', `${THEIRS} REPLACE`].join('\n');
  assert.deepEqual(findConflictHunks(blocks), []);
  assert.deepEqual(findConflictHunks(`  ${OURS} HEAD\n  x\n  ${MID}\n  y\n  ${THEIRS} side\n`), []);
  const diff3 = [`${OURS} HEAD`, 'x', `${'|'.repeat(7)} base`, 'o', MID, 'y', `${THEIRS} side`].join('\n');
  assert.deepEqual(findConflictHunks(diff3)[0].base, ['o']);
});

test('boot: conflicts and d --conflicts run even when chemx\'s own sources are mid-merge', () => {
  withMerge((dir) => {
    const kit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-broken-kit-')));
    try {
      fs.mkdirSync(path.join(kit, 'cli'));
      for (const f of ['index.js', 'conflicts.js']) fs.copyFileSync(path.join(CLI_DIR, f), path.join(kit, 'cli', f));
      write(kit, 'cli/main.js', [`${OURS} HEAD`, 'export const x = 1;', MID, 'export const x = 2;', `${THEIRS} side`, ''].join('\n'));
      const cli = path.join(kit, 'cli', 'index.js');
      const listed = run(dir, ['conflicts'], cli);
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /src\/a\.ts/);
      assert.equal(run(dir, ['d', '--conflicts'], cli).status, 0);
      const other = run(dir, ['read', 'src/ok.ts'], cli);
      assert.equal(other.status, 1);
      assert.match(other.stderr, /cli\/main\.js:1/);
      assert.match(other.stderr, /chemx conflicts/);
    } finally {
      fs.rmSync(kit, { recursive: true, force: true });
    }
  });
});
