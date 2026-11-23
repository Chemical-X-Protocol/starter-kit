import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLineRanges,
  extractColonRanges,
  mergeRanges,
  clusterViolationRanges,
  buildBatchReadCommands
} from './reader-ranges.js';

test('parseLineRanges: parses single line and single ranges', () => {
  assert.deepEqual(parseLineRanges('42'), [{ start: 42, end: 42 }]);
  assert.deepEqual(parseLineRanges('10-25'), [{ start: 10, end: 25 }]);
  assert.deepEqual(parseLineRanges('10:25'), [{ start: 10, end: 25 }]);
});

test('parseLineRanges: parses multiple comma-separated ranges', () => {
  assert.deepEqual(parseLineRanges('1-5, 10-15, 22'), [
    { start: 1, end: 5 },
    { start: 10, end: 15 },
    { start: 22, end: 22 }
  ]);
});

test('parseLineRanges: returns null for invalid range strings', () => {
  assert.equal(parseLineRanges(null), null);
  assert.equal(parseLineRanges(''), null);
  assert.equal(parseLineRanges('abc'), null);
  assert.equal(parseLineRanges('10-abc'), null);
});

test('extractColonRanges: extracts ranges following last colon', () => {
  const res1 = extractColonRanges('src/foo.ts:10-20');
  assert.equal(res1.cleanPath, 'src/foo.ts');
  assert.deepEqual(res1.ranges, [{ start: 10, end: 20 }]);

  const res2 = extractColonRanges('src/foo.ts:1-5,10-15,22');
  assert.equal(res2.cleanPath, 'src/foo.ts');
  assert.deepEqual(res2.ranges, [
    { start: 1, end: 5 },
    { start: 10, end: 15 },
    { start: 22, end: 22 }
  ]);
});

test('extractColonRanges: ignores paths without colon or with Windows drive letters', () => {
  assert.deepEqual(extractColonRanges('src/foo.ts'), { cleanPath: 'src/foo.ts', ranges: null });
  assert.deepEqual(extractColonRanges('C:\\foo\\bar.ts'), { cleanPath: 'C:\\foo\\bar.ts', ranges: null });
});

test('mergeRanges: merges overlapping and adjacent ranges correctly', () => {
  const input = [
    { start: 50, end: 60 },
    { start: 10, end: 20 },
    { start: 18, end: 25 },
    { start: 26, end: 30 }
  ];
  const merged = mergeRanges(input);
  assert.deepEqual(merged, [
    { start: 10, end: 30 },
    { start: 50, end: 60 }
  ]);
});

test('clusterViolationRanges: expands and merges nearby violation lines', () => {
  // Lines 26, 36, 45, 53, 84
  const clustered = clusterViolationRanges([26, 36, 45, 53, 84], { before: 2, after: 3, mergeGap: 4 });
  // 26 -> 24-29
  // 36 (34-39), 45 (43-48), 53 (51-56) chain together because gaps <= 4 lines => 34-56
  // 84 -> 82-87
  assert.deepEqual(clustered, [
    { start: 24, end: 29 },
    { start: 34, end: 56 },
    { start: 82, end: 87 }
  ]);
});

test('buildBatchReadCommands: partitions commands when total lines exceed maxBatchLines', () => {
  const lines = [10, 50, 100, 150];
  const commands = buildBatchReadCommands('src/test.ts', lines, { maxBatchLines: 15 });
  // Each span is ~6 lines. With maxBatchLines = 15, two spans per batch:
  assert.equal(commands.length, 2);
  assert.match(commands[0], /chemx read src\/test\.ts:8-13,48-53 --bare \(batch 1 of 2\)/);
  assert.match(commands[1], /chemx read src\/test\.ts:98-103,148-153 --bare \(batch 2 of 2\)/);
});

test('buildBatchReadCommands: produces single command when within budget', () => {
  const lines = [20, 25];
  const commands = buildBatchReadCommands('src/test.ts', lines, { maxBatchLines: 60 });
  assert.equal(commands.length, 1);
  assert.equal(commands[0], 'chemx read src/test.ts:18-28 --bare');
});
