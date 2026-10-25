import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchFinder } from './search-matched-text.js';

test('matched text (fixed): every occurrence on the line, original case kept, no overlaps', () => {
  const find = buildMatchFinder({ pattern: 'aa', isRegex: false, isCaseInsensitive: false });
  assert.deepEqual(find('aaa aa'), ['aa', 'aa']);
  const loose = buildMatchFinder({ pattern: 'glass', isRegex: false, isCaseInsensitive: true });
  assert.deepEqual(loose('Glass glass GLASS'), ['Glass', 'glass', 'GLASS']);
  assert.deepEqual(loose('nothing'), []);
});

test('matched text (regex): the token the pattern captured, not the whole line', () => {
  const find = buildMatchFinder({ pattern: '--gs-[a-z0-9-]+', isRegex: true, isCaseInsensitive: false });
  assert.deepEqual(find('a { color: var(--gs-blue); border: var(--gs-edge-1) }'), ['--gs-blue', '--gs-edge-1']);
});

test('matched text (regex): empty matches are dropped and case folding applies', () => {
  const find = buildMatchFinder({ pattern: 'x*', isRegex: true, isCaseInsensitive: true });
  assert.deepEqual(find('abXxc'), ['Xx']);
  const anchored = buildMatchFinder({ pattern: '^Import', isRegex: true, isCaseInsensitive: true });
  assert.deepEqual(anchored('import x from "y"'), ['import']);
});
