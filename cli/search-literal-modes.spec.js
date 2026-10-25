import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLiteralSearch, isRipgrepAvailable } from './search-literal.js';

const ENGINES = isRipgrepAvailable() ? ['js', 'rg'] : ['js'];

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-literal-modes-'));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('src/a.scss', '.x { color: var(--gs-blue); border: var(--gs-edge-1) var(--gs-blue); }\n.y { --gs-red: 1; }\n');
  write('src/b.scss', 'a { color: var(--gs-green) }\n');
  write('docs/note.md', 'Glass glass and GLASS here\nno tokens\n');
  return root;
};

for (const engine of ENGINES) {
  test(`literal modes (${engine}): -o keeps the matched text per line and lists the distinct values sorted`, () => {
    const root = makeRoot();
    try {
      const res = runLiteralSearch({ root, pattern: '--gs-[a-z0-9-]+', isRegex: true, isOnlyMatching: true, engine, limit: 50 });
      const first = res.matches.find((m) => m.path === 'src/a.scss' && m.line === 1);
      assert.deepEqual(first.parts, ['--gs-blue', '--gs-edge-1', '--gs-blue']);
      assert.deepEqual(res.distinct, ['--gs-blue', '--gs-edge-1', '--gs-green', '--gs-red']);
      assert.equal(res.totalMatches, 3, 'matching lines, not occurrences');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`literal modes (${engine}): the distinct list is not cut by the match limit`, () => {
    const root = makeRoot();
    try {
      const res = runLiteralSearch({ root, pattern: '--gs-[a-z0-9-]+', isRegex: true, isOnlyMatching: true, engine, limit: 1 });
      assert.equal(res.matches.length, 1);
      assert.equal(res.distinct.length, 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`literal modes (${engine}): -o with a fixed string and ignore-case returns the line's own spelling`, () => {
    const root = makeRoot();
    try {
      const res = runLiteralSearch({ root, pattern: 'glass', isCaseInsensitive: true, isOnlyMatching: true, engine, limit: 5 });
      assert.deepEqual(res.matches[0].parts, ['Glass', 'glass', 'GLASS']);
      assert.deepEqual(res.distinct, ['GLASS', 'Glass', 'glass']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`literal modes (${engine}): files lists every matched path once, even with no match rows kept`, () => {
    const root = makeRoot();
    try {
      const res = runLiteralSearch({ root, pattern: '--gs-', engine, limit: 0 });
      assert.deepEqual(res.files, ['src/a.scss', 'src/b.scss']);
      assert.equal(res.matches.length, 0);
      assert.equal(res.totalMatches, 3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`literal modes (${engine}): lookaround and backreferences are refused in regex mode`, () => {
    const root = makeRoot();
    try {
      assert.throws(() => runLiteralSearch({ root, pattern: 'a(?=b)', isRegex: true, engine }), /lookaround/);
      assert.throws(() => runLiteralSearch({ root, pattern: '(a)\\1', isRegex: true, engine }), /backreference/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('literal modes (js): a nested quantifier is refused before it can stall the backtracking engine', () => {
  const root = makeRoot();
  try {
    assert.throws(() => runLiteralSearch({ root, pattern: '(a+)+$', isRegex: true, engine: 'js' }), /nested quantifier/);
    const safe = runLiteralSearch({ root, pattern: '(gs-)+blue', isRegex: true, engine: 'js' });
    assert.equal(safe.totalMatches, 1, 'one line holds --gs-blue, twice');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('literal modes (rg): ripgrep runs a nested quantifier in linear time, so it is allowed', { skip: isRipgrepAvailable() ? false : 'ripgrep not on PATH' }, () => {
  const root = makeRoot();
  try {
    const res = runLiteralSearch({ root, pattern: '(a+)+$', isRegex: true, engine: 'rg' });
    assert.equal(typeof res.totalMatches, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
