// fold.js (engine doc section 8, maximality): which groups fold into which slot, by rule, on hand-built
// groups (instances are { file, start, end } spans; scores decide pass-1 order).
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldGroups } from './fold.js';
import { rankGroups } from './rank.js';

const span = (file, start, end) => ({ file, start, end, anchors: [] });

const group = (id, score, instances, extra = {}) => ({ id, score, path: 'N1-fp1', kind: 'stmt', facetKey: 'js:plain:src:.', mass: 20, instances, ...extra });

const byScore = (groups) => [...groups].sort((a, b) => b.score - a.score);

const fold = (groups, options) => {
  const ranked = byScore(groups);
  const roots = foldGroups(ranked, options);
  return { roots: roots.map((root) => root.id), byId: new Map(ranked.map((entry) => [entry.id, entry])) };
};

test('inside: a group whose every instance lies in a higher-scored group folds into it', () => {
  const host = group('host', 100, [span('a.js', 0, 100), span('b.js', 0, 100)], { kind: 'fn' });
  const piece = group('piece', 50, [span('a.js', 10, 20), span('b.js', 10, 20)], { kind: 'expr', mass: 9 });
  const { roots, byId } = fold([host, piece]);
  assert.deepEqual(roots, ['host']);
  assert.equal(byId.get('piece').foldReason, 'inside');
  assert.deepEqual(byId.get('host').folded, [{ id: 'piece', reason: 'inside' }]);
});

test('fragment: a higher-scored expression held by a window everywhere but one site folds into the window', () => {
  const window = group('window', 40, [span('a.js', 0, 50), span('b.js', 0, 50), span('c.js', 0, 50)], { path: 'N2', kind: 'window', mass: 60 });
  const expr = group('expr', 90, [span('a.js', 5, 15), span('b.js', 5, 15), span('c.js', 5, 15), span('d.js', 0, 10)], { kind: 'expr' });
  const { roots, byId } = fold([window, expr]);
  assert.deepEqual(roots, ['window']);
  assert.equal(byId.get('expr').foldReason, 'fragment');
});

test('fragment: two sites outside the window are a group of their own, so the expression keeps its slot', () => {
  const window = group('window', 40, [span('a.js', 0, 50), span('b.js', 0, 50)], { path: 'N2', kind: 'window', mass: 60 });
  const expr = group('expr', 90, [span('a.js', 5, 15), span('b.js', 5, 15), span('c.js', 0, 10), span('d.js', 0, 10)], { kind: 'expr' });
  assert.deepEqual(fold([window, expr]).roots, ['expr', 'window']);
});

test('overlap: windows crossing a higher-scored window at half their instances fold into it', () => {
  const long = group('long', 80, [span('a.js', 0, 60), span('b.js', 0, 60)], { path: 'N2', kind: 'window' });
  const shifted = group('shifted', 60, [span('a.js', 40, 90), span('b.js', 40, 90), span('c.js', 0, 50)], { path: 'N2', kind: 'window' });
  const apart = group('apart', 50, [span('a.js', 100, 150), span('b.js', 100, 150)], { path: 'N2', kind: 'window' });
  const { roots, byId } = fold([long, shifted, apart]);
  assert.deepEqual(roots, ['long', 'apart']);
  assert.equal(byId.get('shifted').foldReason, 'overlap');
});

test('block: W groups that share statements of one block are one slot, containment included', () => {
  const pairs = group('pairs', 90, [span('f.js', 0, 20), span('f.js', 30, 50), span('f.js', 60, 80)], { path: 'W', kind: 'window' });
  const singles = group('singles', 70, [span('f.js', 0, 10), span('f.js', 30, 40), span('f.js', 60, 70), span('f.js', 200, 210)], { path: 'W' });
  const { byId } = fold([pairs, singles]);
  assert.equal(byId.get('singles').foldReason, 'block');
});

test('wrapper: a statement adding less than the G1 mass floor around a higher-scored expression folds; a fn never does', () => {
  const expr = group('expr', 90, [span('a.js', 6, 20), span('b.js', 6, 20), span('c.js', 6, 20)], { kind: 'expr', mass: 10 });
  const stmt = group('stmt', 60, [span('a.js', 0, 21), span('b.js', 0, 21)], { mass: 13 });
  const fn = group('fn', 55, [span('a.js', 0, 22), span('b.js', 0, 22)], { kind: 'fn', mass: 14 });
  const heavy = group('heavy', 50, [span('b.js', 0, 23), span('c.js', 0, 23)], { mass: 30 });
  const { roots, byId } = fold([expr, stmt, fn, heavy]);
  assert.equal(byId.get('stmt').foldReason, 'wrapper');
  assert.ok(roots.includes('fn'));
  assert.ok(roots.includes('heavy'));
});

test('variant: one skeleton and shared anchors fold an fp2 variant; other anchors keep their slot', () => {
  const skeletons = new Map([['push-a', 'S'], ['push-b', 'S'], ['other', 'S']]);
  const anchors = new Map([['push-a', ['call:push', 'key:rule', 'key:line']], ['push-b', ['call:push', 'key:rule', 'key:column']], ['other', ['call:join', 'import:node:path#default']]]);
  const options = { skeletonOf: (entry) => skeletons.get(entry.id) ?? null, anchorsOf: (entry) => anchors.get(entry.id) };
  const pushA = group('push-a', 90, [span('a.js', 0, 10), span('b.js', 0, 10)]);
  const pushB = group('push-b', 80, [span('c.js', 0, 10), span('d.js', 0, 10)]);
  const other = group('other', 70, [span('e.js', 0, 10), span('f.js', 0, 10)]);
  const { roots, byId } = fold([pushA, pushB, other], options);
  assert.deepEqual(roots, ['push-a', 'other']);
  assert.equal(byId.get('push-b').foldReason, 'variant');
});

test('rankGroups: a window depends on a piece that stands elsewhere, and a folded piece is no slot', () => {
  const facetKey = 'js:plain:src:.';
  const window = group('window', 0, [span('a.js', 0, 50), span('b.js', 0, 50), span('c.js', 0, 50)], { path: 'N2', kind: 'window', mass: 60, memberCount: 3, facetKey });
  const piece = group('piece', 0, [span('a.js', 5, 15), span('b.js', 5, 15), span('c.js', 5, 15), span('d.js', 0, 10), span('e.js', 0, 10)], { kind: 'expr', mass: 9, memberCount: 5, facetKey });
  const ranked = rankGroups([window, piece]);
  assert.ok(ranked.every((entry) => entry.rank !== null));
  assert.deepEqual(window.dependsOn, ['piece']);
  const lone = group('lone', 0, [span('a.js', 20, 30), span('b.js', 20, 30), span('c.js', 20, 30), span('d.js', 20, 30)], { kind: 'expr', mass: 30, memberCount: 4, facetKey });
  rankGroups([window, lone]);
  assert.equal(lone.foldedInto, 'window');
  assert.equal(lone.rank, null);
  assert.deepEqual(window.dependsOn, []);
});

test('rankGroups: equal-scored groups fold the same way whatever order they arrive in', () => {
  const make = () => [
    group('w1', 0, [span('a.js', 0, 60), span('b.js', 0, 60)], { path: 'N2', kind: 'window', memberCount: 2 }),
    group('w2', 0, [span('a.js', 40, 90), span('b.js', 40, 90)], { path: 'N2', kind: 'window', memberCount: 2 })
  ];
  const rootsOf = (groups) => rankGroups(groups).filter((entry) => entry.foldedInto === null).map((entry) => entry.id);
  const first = rootsOf(make());
  const second = rootsOf(make().reverse());
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
});

test('fragment: folds do not chain, so a group keeps its slot when the host it sits in is folded elsewhere', () => {
  const window = (score) => group('C', score, [span('a.js', 0, 100), span('b.js', 0, 100)], { path: 'N2', kind: 'window', mass: 60 });
  const host = (score) => group('B', score, [span('a.js', 10, 90), span('b.js', 10, 90), span('z.js', 0, 1000)], { kind: 'fn' });
  const held = (score) => group('A', score, [span('z.js', 100, 200), span('z.js', 300, 400), span('z.js', 500, 600)]);
  for (const [scoreA, scoreB] of [[60, 80], [500, 80]]) {
    const { roots, byId } = fold([window(100), host(scoreB), held(scoreA)]);
    assert.ok(roots.includes('C'));
    assert.notEqual(byId.get('A').foldedInto, 'C', `A is not hidden under C at score ${scoreA}`);
    assert.notEqual(byId.get('A').foldedVia, 'B', 'a group is never reported through a host that was itself folded');
  }
});

test('foldedVia names the family root a member hit when it is not the slot', () => {
  const slot = group('slot', 100, [span('a.js', 0, 100), span('b.js', 0, 100)], { path: 'N2', kind: 'window', mass: 60 });
  const shifted = group('shifted', 90, [span('a.js', 50, 150), span('b.js', 50, 150)], { path: 'N2', kind: 'window', mass: 60 });
  const piece = group('piece', 50, [span('a.js', 110, 120), span('b.js', 110, 120)], { kind: 'expr', mass: 9 });
  const { byId } = fold([slot, shifted, piece]);
  assert.equal(byId.get('shifted').foldedInto, 'slot');
  assert.equal(byId.get('shifted').foldedVia, null);
  assert.equal(byId.get('piece').foldedInto, 'slot');
  assert.equal(byId.get('piece').foldedVia, 'shifted');
});
