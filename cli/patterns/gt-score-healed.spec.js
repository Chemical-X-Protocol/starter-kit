import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreGroups } from './gt-score.js';

const anchor = (id, file, isStale) => ({ id, file, isStale, span: { startLine: 1, endLine: 5 } });
const item = (id, anchors) => ({ id, class: 'A', anchors });

test('an item whose anchors are all stale is excluded from recall and reported as healed', () => {
  const live = item('A1', [anchor('A1.1', 'a.js', false), anchor('A1.2', 'b.js', false)]);
  const healed = item('A6', [anchor('A6.1', 'c.js', true), anchor('A6.2', 'd.js', true)]);
  const group = { id: 'g1', path: 'P', occurrences: [{ file: 'a.js', startLine: 1, endLine: 5 }, { file: 'b.js', startLine: 1, endLine: 5 }] };
  const report = scoreGroups([live, healed], [group]);
  assert.deepEqual(report.healedItems, ['A6']);
  assert.equal(report.recallA.items, 1);
  assert.equal(report.recallA.recall, 1);
  assert.equal(report.recallByScope.code.items, 1);
});

test('a subsumedBy pair with a healed side skips inheritance and does not throw', () => {
  const parent = item('A21', [anchor('A21.1', 'a.js', false), anchor('A21.2', 'b.js', false)]);
  const child = { ...item('A23', [anchor('A23.1', 'c.js', true), anchor('A23.2', 'd.js', true)]), subsumedBy: 'A21' };
  const group = { id: 'g1', path: 'P', occurrences: [{ file: 'a.js', startLine: 1, endLine: 5 }, { file: 'b.js', startLine: 1, endLine: 5 }] };
  const report = scoreGroups([parent, child], [group]);
  assert.deepEqual(report.healedItems, ['A23']);
  assert.equal(report.recallA.items, 1);
});
