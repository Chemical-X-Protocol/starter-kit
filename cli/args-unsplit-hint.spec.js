/**
 * The zsh unsplit-argument hint (#6773): zsh does not word-split an unquoted $var, so a command that
 * expects several paths or specs gets one argument that joins them with spaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UNSPLIT_HINT, findUnsplitArgument, unsplitHint, withUnsplitHint } from './args-unsplit-hint.js';

const withDir = (files, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-unsplit-'));
  for (const name of files) fs.writeFileSync(path.join(dir, name), 'x\n');
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('the hint names the cause and both fixes', () => {
  assert.equal(UNSPLIT_HINT, 'one argument contains spaces: did a zsh variable not split? use an array or ${=var}');
});

test('an argument that joins two paths with a space, and is not a path itself, is the unsplit one', () => {
  withDir(['a.js', 'b.js'], (dir) => {
    assert.equal(findUnsplitArgument(['a.js b.js'], { cwd: dir }), 'a.js b.js');
    assert.equal(findUnsplitArgument(['x.js', 'a.js b.js'], { cwd: dir }), 'a.js b.js');
  });
});

test('a path that really has a space in its name is not flagged', () => {
  withDir(['my file.txt'], (dir) => {
    assert.equal(findUnsplitArgument(['my file.txt'], { cwd: dir }), null);
    assert.equal(unsplitHint(['my file.txt'], { cwd: dir }), '');
  });
});

test('arguments without inner whitespace never trigger it', () => {
  withDir([], (dir) => {
    assert.equal(findUnsplitArgument(['missing.js', '', '  padded.js  ', '--flag'], { cwd: dir }), null);
    assert.equal(findUnsplitArgument([], { cwd: dir }), null);
  });
});

test('an absolute joined argument is looked up as given, a relative one against cwd', () => {
  withDir(['a.js', 'b.js'], (dir) => {
    const joined = `${path.join(dir, 'a.js')} ${path.join(dir, 'b.js')}`;
    assert.equal(findUnsplitArgument([joined], { cwd: process.cwd() }), joined);
  });
});

test('a custom exists() decides what is on disk', () => {
  assert.equal(findUnsplitArgument(['a b'], { exists: () => true }), null);
  assert.equal(findUnsplitArgument(['a b'], { exists: () => false }), 'a b');
});

test('unsplitHint returns the hint text or an empty string', () => {
  assert.equal(unsplitHint(['a b'], { exists: () => false }), UNSPLIT_HINT);
  assert.equal(unsplitHint(['a'], { exists: () => false }), '');
});

test('withUnsplitHint appends the hint to a message only when an argument is unsplit', () => {
  assert.equal(withUnsplitHint('File not found: a b', ['a b'], { exists: () => false }), `File not found: a b (${UNSPLIT_HINT})`);
  assert.equal(withUnsplitHint('File not found: a', ['a'], { exists: () => false }), 'File not found: a');
});
