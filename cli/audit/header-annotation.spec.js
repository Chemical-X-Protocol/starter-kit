import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuditPostFilters } from './suppressions.js';

const finding = (line, rule = 'ARCH_FILE_TOO_LARGE') => ({ filePath: 'a.php', line, column: 1, rule, hazard: 'h' });
const annotation = '// chemx-allow: ARCH_FILE_TOO_LARGE legacy file kept whole';

test('a header annotation suppresses a line-1 finding when regions and header range are given', () => {
  const lines = ['<?php', annotation, 'echo 1;'];
  const commentRegions = [[], [[0, annotation.length]], []];
  const out = applyAuditPostFilters([finding(1)], lines, { commentRegions, fileHeaderEndLine: 2 });
  assert.equal(out.length, 0);
});

test('an annotation outside the header range does not suppress a line-1 finding', () => {
  const lines = ['<?php', 'echo 1;', annotation];
  const commentRegions = [[], [], [[0, annotation.length]]];
  const out = applyAuditPostFilters([finding(1)], lines, { commentRegions, fileHeaderEndLine: 2 });
  assert.equal(out.length, 1);
});

test('the header range does not widen suppression for findings below line 1', () => {
  const lines = ['<?php', annotation, 'echo 1;', 'echo 2;'];
  const commentRegions = [[], [[0, annotation.length]], [], []];
  const out = applyAuditPostFilters([finding(4)], lines, { commentRegions, fileHeaderEndLine: 2 });
  assert.equal(out.length, 1);
});

test('precomputed regions replace the scanner: a marker outside any region is ignored', () => {
  const out = applyAuditPostFilters([finding(1)], [annotation], { commentRegions: [[]] });
  assert.equal(out.length, 1);
});

test('without options the line scanner still decides', () => {
  assert.equal(applyAuditPostFilters([finding(1)], [annotation]).length, 0);
});
