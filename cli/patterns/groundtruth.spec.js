// Ground-truth harness: fixtures and labels agree, anchors survive line shifts, and the scorer is
// deterministic and credits/penalizes as the Forge design defines. Uses only the committed fixtures
// (labels.json spans), never the live repo, so unrelated edits cannot break it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFixture, excerptHash, locateExcerpt, findExcerptHits, assignOrderedHits } from './gt-text.js';
import { scoreGroups, MIN_DENSITY } from './gt-score.js';
import { legacyGroups } from './gt-score-cli.js';

const GT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gt');
const LABELS = JSON.parse(fs.readFileSync(path.join(GT_DIR, 'labels.json'), 'utf-8'));

const withSpans = (items) => items.map((item) => ({
  ...item,
  anchors: item.anchors.map((anchor) => ({ ...anchor, isStale: false, span: { startLine: anchor.startLine, endLine: anchor.endLine } }))
}));
const ITEMS = withSpans(LABELS.items);
const itemById = (id) => ITEMS.find((item) => item.id === id);

const occurrenceOf = (anchor) => ({ file: anchor.file, startLine: anchor.startLine, endLine: anchor.endLine });
const groupOf = (id, anchors, extra = {}) => ({ id, path: 'N1', occurrences: anchors.map(occurrenceOf), ...extra });
const creditOf = (report, itemId) => report.perItem.find((row) => row.itemId === itemId).credit;

test('labels cover A1-A26, B1-B11 and C1-C7 with provenance and fixtures', () => {
  const idsOf = (cls) => LABELS.items.filter((item) => item.class === cls).map((item) => item.id);
  assert.deepEqual(idsOf('A'), Array.from({ length: 26 }, (_, i) => `A${i + 1}`));
  assert.deepEqual(idsOf('B'), Array.from({ length: 11 }, (_, i) => `B${i + 1}`));
  assert.deepEqual(idsOf('C'), Array.from({ length: 7 }, (_, i) => `C${i + 1}`));
});

test('every anchor has a verbatim fixture excerpt whose hash matches labels.json', () => {
  for (const item of LABELS.items) {
    const fixture = parseFixture(fs.readFileSync(path.join(GT_DIR, `${item.id}.txt`), 'utf-8'));
    assert.deepEqual(fixture.map((entry) => entry.id), item.anchors.map((anchor) => anchor.id), item.id);
    for (const anchor of item.anchors) {
      const entry = fixture.find((candidate) => candidate.id === anchor.id);
      assert.equal(entry.hash, anchor.hash, anchor.id);
      assert.equal(excerptHash(entry.lines), anchor.hash, `${anchor.id} excerpt drifted from its hash`);
      assert.equal(entry.spec, `${anchor.file}:${anchor.startLine}-${anchor.endLine}`, anchor.id);
    }
  }
});

test('anchors are located by content and survive line shifts', () => {
  const anchor = LABELS.items.find((item) => item.id === 'A6').anchors[0];
  const excerpt = parseFixture(fs.readFileSync(path.join(GT_DIR, 'A6.txt'), 'utf-8'))[0].lines;
  const padding = Array.from({ length: 37 }, (_, i) => `// unrelated line ${i}`);
  const shifted = [...padding, '', ...excerpt, '// tail'];
  const found = locateExcerpt(shifted, excerpt, anchor.startLine);
  assert.equal(found.startLine, padding.length + 1 + 1 + excerpt.findIndex((line) => line.trim() !== ''));
  assert.equal(locateExcerpt(padding, excerpt, 1), null);
});

test('identical-text anchors resolve to distinct spans in file order after a line shift', () => {
  const a23 = LABELS.items.find((item) => item.id === 'A23');
  const excerpt = parseFixture(fs.readFileSync(path.join(GT_DIR, 'A23.txt'), 'utf-8'))[0].lines;
  const block = (tag) => [...Array.from({ length: 14 }, (_, i) => `// ${tag} filler ${i}`), ...excerpt];
  const fileLines = [...block('a'), ...block('b'), ...block('c')];
  const hits = findExcerptHits(fileLines, excerpt);
  assert.equal(hits.length, 3);
  const anchors = [{ startLine: hits[0].startLine - 9 }, { startLine: hits[1].startLine - 9 }];
  const spans = assignOrderedHits(anchors, hits);
  assert.deepEqual(spans, [hits[0], hits[1]]);
  assert.ok(a23.anchors.length > 1);
});

test('a complete A group scores 1, two of five anchors score 0.5, a lone anchor scores 0', () => {
  const a7 = itemById('A7');
  assert.equal(creditOf(scoreGroups(ITEMS, [groupOf('g', a7.anchors)]), 'A7'), 1);
  assert.equal(creditOf(scoreGroups(ITEMS, [groupOf('g', a7.anchors.slice(0, 2))]), 'A7'), 0.5);
  assert.equal(creditOf(scoreGroups(ITEMS, [groupOf('g', a7.anchors.slice(0, 1))]), 'A7'), 0);
});

test('a B-class site inside an A group is foreign and downgrades it to partial', () => {
  const a24 = itemById('A24');
  const contaminant = itemById('B2').anchors[0];
  const report = scoreGroups(ITEMS, [groupOf('g', [...a24.anchors, contaminant])]);
  assert.equal(creditOf(report, 'A24'), 0.5);
});

test('a bucket that only brushes an item is a swamp, not a find', () => {
  const a6 = itemById('A6');
  const swampSize = Math.ceil(a6.anchors.length / MIN_DENSITY) + 5;
  const noise = Array.from({ length: swampSize }, (_, i) => ({ file: `nowhere/file-${i}.js`, startLine: 1, endLine: 1 }));
  const group = { id: 'swamp', path: 'legacy', occurrences: [...a6.anchors.map(occurrenceOf), ...noise] };
  assert.equal(creditOf(scoreGroups(ITEMS, [group]), 'A6'), 0);
});

test('a group over two or more anchors of a B item is a false positive attributed to its path', () => {
  const report = scoreGroups(ITEMS, [groupOf('b1', itemById('B1').anchors, { path: 'legacy' })]);
  assert.deepEqual(report.falseItems.surfaced, ['B1']);
  assert.equal(report.perPath.legacy.false, 1);
  assert.equal(report.perPath.legacy.labeledPrecision, 0);
});

test('A23 is found by an A21 group and C groups are reported borderline', () => {
  const report = scoreGroups(ITEMS, [groupOf('a21', itemById('A21').anchors), groupOf('c1', itemById('C1').anchors)]);
  assert.equal(creditOf(report, 'A23'), 1);
  assert.deepEqual(report.borderlineSurfaced, ['C1']);
});

test('precision and credit are attributed per detection path', () => {
  const report = scoreGroups(ITEMS, [groupOf('x', itemById('A19').anchors, { path: 'N3' }), groupOf('y', itemById('A10').anchors, { path: 'L2' })]);
  assert.equal(report.perPath.N3.itemCredit, 1);
  assert.equal(report.perPath.L2.itemCredit, 1);
  assert.equal(report.perPath.N3.labeledPrecision, 1);
});

test('scoring is deterministic and independent of group order', () => {
  const groups = ['A1', 'A4', 'A7', 'A12', 'A24', 'B1', 'C3'].map((id) => groupOf(`g-${id}`, itemById(id).anchors));
  const first = JSON.stringify(scoreGroups(ITEMS, groups));
  const second = JSON.stringify(scoreGroups(ITEMS, groups));
  const reversed = JSON.stringify(scoreGroups(ITEMS, [...groups].reverse()));
  assert.equal(first, second);
  assert.equal(first, reversed);
});

test('legacy candidates adapt to single-line occurrences on the legacy path', () => {
  const [group] = legacyGroups([{ id: 'PREDICATE_LOGIC::x', type: 'PREDICATE_LOGIC', occurrences: [{ filePath: 'cli/a.js', line: 7, column: 1 }] }]);
  assert.deepEqual(group.occurrences, [{ file: 'cli/a.js', startLine: 7, endLine: 7 }]);
  assert.equal(group.path, 'legacy');
});
