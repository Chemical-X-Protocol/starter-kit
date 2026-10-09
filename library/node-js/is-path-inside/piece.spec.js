import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathInside } from './piece.js';

const withRoot = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-path-inside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('a nested file is inside', (t) => {
  const root = withRoot(t);
  assert.equal(isPathInside(path.join(root, 'a', 'b.txt'), root), true);
});

test('the boundary itself is inside', (t) => {
  const root = withRoot(t);
  assert.equal(isPathInside(root, root), true);
});

test('a parent and a sibling are outside', (t) => {
  const root = withRoot(t);
  assert.equal(isPathInside(path.dirname(root), root), false);
  assert.equal(isPathInside(`${root}-sibling`, root), false);
});

test('a dot-dot prefixed name below the root is still inside', (t) => {
  const root = withRoot(t);
  assert.equal(isPathInside(path.join(root, '..cache', 'x'), root), true);
});

test('a path on another root is outside', () => {
  const [first, second] = [path.resolve(path.sep, 'a'), path.resolve(path.sep, 'b')];
  assert.equal(isPathInside(second, first), false);
});
