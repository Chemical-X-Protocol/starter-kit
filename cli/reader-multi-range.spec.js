import test from 'node:test';
import assert from 'node:assert/strict';
import { readTokenOptimized } from './reader.js';

test('readTokenOptimized: reads multiple ranges with clean dividers', () => {
  const fixturePath = 'app/components/molecules/funnel/funnel-system-layers.types.ts';
  const resBare = readTokenOptimized(fixturePath, {
    ranges: [{ start: 1, end: 3 }, { start: 10, end: 12 }],
    bare: true
  });

  assert.equal(resBare.mode, 'multi-range');
  assert.equal(resBare.ranges.length, 2);
  assert.match(resBare.content, /\/\/ --- lines 1-3 ---/);
  assert.match(resBare.content, /\/\/ --- lines 10-12 ---/);
  assert.match(resBare.content, /export type LayerTone/);
});

test('readTokenOptimized: parses colon multi-range from target path', () => {
  const target = 'app/components/molecules/funnel/funnel-system-layers.types.ts:1-2,14-15';
  const res = readTokenOptimized(target, { bare: true });

  assert.equal(res.mode, 'multi-range');
  assert.deepEqual(res.ranges, [{ start: 1, end: 2 }, { start: 14, end: 15 }]);
});
