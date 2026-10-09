// Forge grouping and gates against the ground truth (phases doc, P3 acceptance), on the gt sandbox: every
// P1 fixture excerpt written back to its labeled file and lines (gt-sandbox.js), fingerprinted, grouped by
// N1/N2/N3/W/T and scored with the P1 scorer. Only excerpts that are whole declarations or elements
// parse on their own, so the items asserted here are the ones the sandbox can carry; A1 and A19 (W inside
// long functions) are covered by siblings.spec.js on a full verbatim copy.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGtSandbox, gtItems } from './gt-sandbox.js';
import { runForgeGroups, PATH_ORDER } from './forge-groups.js';
import { toScorerGroups } from './group-shape.js';
import { scoreGroups } from '../patterns/gt-score.js';

delete process.env.CHEMX_PROJECT_ROOT;

const ITEMS = gtItems();
const itemById = (id) => ITEMS.find((item) => item.id === id);

// One sandbox for the whole file: building and fingerprinting it is the slow part.
const cleanups = [];
const state = {};
before(() => {
  const sandbox = createGtSandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const result = runForgeGroups(sandbox.dir);
  Object.assign(state, { sandbox, result, report: scoreGroups(ITEMS, toScorerGroups(result.groups)) });
});
after(() => cleanups.forEach((cleanup) => cleanup()));

const grouped = () => state;

const creditOf = (report, id) => report.perItem.find((row) => row.itemId === id).credit;

const touches = (group, anchor) => group.instances.some((instance) => {
  const isSameFile = instance.file === anchor.file;
  return isSameFile && instance.startLine <= anchor.endLine && instance.endLine >= anchor.startLine;
});

test('no B item forms a group and no C item is surfaced', (t) => {
  const { report } = grouped(t);
  assert.deepEqual(report.falseItems.surfaced, []);
  assert.deepEqual(report.borderlineSurfaced, []);
});

test('A24 is one T group of exactly 11 stat tiles in 3 files, found in full', (t) => {
  const { result, report } = grouped(t);
  const tiles = result.groups.filter((group) => group.path === 'T' && itemById('A24').anchors.some((anchor) => touches(group, anchor)));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].memberCount, 11);
  assert.equal(tiles[0].fileCount, 3);
  assert.equal(creditOf(report, 'A24'), 1);
});

test('B2 (three child-role orders) is rejected by structural-role refinement', (t) => {
  const { result } = grouped(t);
  const b2 = itemById('B2').anchors;
  const refusedSites = b2.filter((anchor) => result.refined.some((group) => touches(group, anchor) && group.rejectReason.startsWith('refine.')));
  assert.ok(refusedSites.length >= 2, `${refusedSites.length} B2 sites rejected by refinement`);
  const formed = result.groups.filter((group) => b2.filter((anchor) => touches(group, anchor)).length >= 2);
  assert.deepEqual(formed, []);
});

test('A25 settings cards (badge tones differ) group as template siblings under one parent', (t) => {
  const { result, report } = grouped(t);
  const cards = result.groups.filter((group) => group.path === 'W' && group.kind === 'tmpl' && itemById('A25').anchors.some((anchor) => touches(group, anchor)));
  assert.equal(cards.length, 1);
  assert.ok(cards[0].memberCount >= 3);
  assert.equal(cards[0].fileCount, 1);
  assert.equal(creditOf(report, 'A25'), 1);
});

test('exact buckets find A7 (N1 L2), A22 (N1 L1 expr) and the A4 path check', (t) => {
  const { report } = grouped(t);
  assert.equal(creditOf(report, 'A7'), 1);
  assert.equal(creditOf(report, 'A22'), 1);
  assert.ok(creditOf(report, 'A4') >= 0.5);
});

test('B4 (same name, different runtime facet) and B3 (excluded blueprints) never meet', (t) => {
  const { result } = grouped(t);
  const blueprintSites = result.groups.flatMap((group) => group.instances).filter((instance) => instance.file.startsWith('blueprints/'));
  assert.deepEqual(blueprintSites, []);
  for (const group of result.groups) assert.equal(new Set(group.instances.map((instance) => instance.file.endsWith('.vue') ? 'vue' : 'script')).size, 1);
  const b4 = itemById('B4').anchors;
  assert.deepEqual(result.groups.filter((group) => b4.every((anchor) => touches(group, anchor))), []);
});

test('every group is gated: a known path, at least 2 files, and template groups of 3 or more', (t) => {
  const { result } = grouped(t);
  assert.ok(result.groups.length > 0);
  for (const group of result.groups) {
    assert.ok(PATH_ORDER.includes(group.path), group.path);
    const isCrossFile = group.path !== 'W';
    if (isCrossFile) assert.ok(group.fileCount >= 2, `${group.path} ${group.id} spans one file`);
    const isTemplate = group.path === 'T';
    if (isTemplate) assert.ok(group.memberCount >= 3);
  }
});
