// P3 acceptance on the ground truth (phases doc, P3): the whole Forge run (grouping, LGG, R1-R8 with
// refinement, drift, ranking and the pattern_groups store) over the gt sandbox, every P1 fixture excerpt
// written back to its labeled file and lines (gt-sandbox.js), scored with the P1 scorer (gt-score.js).
// The library is P4, so this is the harvest-only (--no-library) recall.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGtSandbox, gtItems } from './gt-sandbox.js';
import { runForgeGroups } from './forge-groups.js';
import { toScorerGroups } from './group-shape.js';
import { REJECT_CODES } from './rejects.js';
import { scoreGroups } from '../patterns/gt-score.js';
import { LEVEL_WEIGHTS, TOP_SURFACED } from './rank.js';
import { findStoredGroup, suppressGroup } from './group-store.js';

delete process.env.CHEMX_PROJECT_ROOT;

const ITEMS = gtItems();
const itemById = (id) => ITEMS.find((item) => item.id === id);
const B_ITEMS = ITEMS.filter((item) => item.class === 'B').map((item) => item.id);

const cleanups = [];
const state = {};
before(() => {
  const sandbox = createGtSandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const result = runForgeGroups(sandbox.dir);
  Object.assign(state, { sandbox, result, report: scoreGroups(ITEMS, toScorerGroups(result.groups)) });
});
after(() => cleanups.forEach((cleanup) => cleanup()));

const creditOf = (id) => state.report.perItem.find((row) => row.itemId === id).credit;

const touches = (span, anchor) => span.file === anchor.file && span.startLine <= anchor.endLine && span.endLine >= anchor.startLine;
const anchorsCovered = (group, id) => itemById(id).anchors.filter((anchor) => group.instances.some((instance) => touches(instance, anchor))).length;
const bestFor = (id, isWanted = () => true) => state.result.groups.filter(isWanted).sort((a, b) => anchorsCovered(b, id) - anchorsCovered(a, id))[0];

test('harvest-only recall over the A items is at least 0.70, partial credit counting 0.5', () => {
  const { recallA } = state.report;
  assert.ok(recallA.recall >= 0.7, `recall ${recallA.credit}/${recallA.items} = ${recallA.recall.toFixed(3)}`);
});

test('no B item forms a group: B1-B11 none surfaced, precision 1.0 on the B set', () => {
  assert.equal(B_ITEMS.length, 11);
  assert.deepEqual(state.report.falseItems.surfaced, []);
  assert.equal(state.report.precision.falseGroups, 0);
});

test('no C item is surfaced (C1-C3 included)', () => {
  assert.deepEqual(state.report.borderlineSurfaced, []);
});

test('A1: W covers at least 10 of the 13 two-form flags across the interleaved gaps, through a transform hole', () => {
  const flags = bestFor('A1', (group) => group.path === 'W');
  assert.ok(anchorsCovered(flags, 'A1') >= 10, `${anchorsCovered(flags, 'A1')} of 13`);
  assert.ok(flags.lgg.holes.some((hole) => hole.kind === 'transform'));
  assert.equal(creditOf('A1'), 1);
});

test('A19: W reaches the four gh discussion retries across sibling blocks', () => {
  const retries = bestFor('A19', (group) => group.path === 'W');
  assert.ok(anchorsCovered(retries, 'A19') >= 3);
  assert.equal(creditOf('A19'), 1);
});

test('A21: an N1 fp3 fn group whose LGG holes are the url, the body and the refetch callback', () => {
  const swarm = bestFor('A21', (group) => group.path === 'N1-fp3' && group.kind === 'fn');
  assert.ok(anchorsCovered(swarm, 'A21') >= 3);
  const kinds = new Set(swarm.lgg.holes.map((hole) => hole.kind));
  assert.deepEqual([...kinds].sort(), ['expr', 'literal', 'ref']);
  assert.ok(swarm.lgg.captures.some((capture) => capture.name === 'error'));
  assert.equal(creditOf('A21'), 1);
});

test('A22: the three pollers group, their LGG holes are the delay literal and the tick ref', () => {
  const pollers = bestFor('A22', (group) => Boolean(group.lgg));
  assert.equal(anchorsCovered(pollers, 'A22'), 3);
  assert.deepEqual(pollers.lgg.holes.map((hole) => hole.kind).sort(), ['literal', 'ref']);
  assert.ok(pollers.lgg.holes.some((hole) => hole.examples.includes('2000')));
  assert.equal(creditOf('A22'), 1);
});

test('A24: one T group of exactly 11 stat tiles', () => {
  const tiles = state.result.groups.filter((group) => group.path === 'T' && anchorsCovered(group, 'A24') > 0);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].memberCount, 11);
  assert.equal(creditOf('A24'), 1);
});

test('A7 and A12 are found in full', () => {
  assert.equal(creditOf('A7'), 1);
  assert.equal(creditOf('A12'), 1);
});

test('A4: the path check is found, and typecheck-command.js is drift of the resolve-then-check window', () => {
  assert.ok(creditOf('A4') >= 0.5);
  const typecheck = itemById('A4').anchors.find((anchor) => anchor.file === 'cli/typecheck-command.js');
  const drifted = state.result.groups.filter((group) => (group.drift ?? []).some((span) => touches(span, typecheck)));
  assert.ok(drifted.length > 0, 'a group lists typecheck-command.js:42 as drift');
  assert.ok(drifted.every((group) => group.status === 'candidate'));
});

test('every rejected group carries its reason code and every failing code', () => {
  assert.ok(state.result.rejected.length > 0);
  for (const group of state.result.rejected) {
    const isCode = REJECT_CODES.includes(group.rejectReason) || group.rejectReason.startsWith('refine.');
    assert.ok(isCode, group.rejectReason);
    assert.ok(Array.isArray(group.rejectCodes));
  }
});

test('the run is stored: pattern_groups rows by status, members by role', () => {
  const db = state.sandbox.openDb();
  const statuses = db.prepare('SELECT status, COUNT(*) AS n FROM pattern_groups GROUP BY status ORDER BY status').all();
  const stored = Object.fromEntries(statuses.map((row) => [row.status, row.n]));
  assert.equal(stored.candidate, state.result.groups.filter((group) => group.status === 'candidate').length);
  assert.ok(stored.rejected >= state.result.rejected.length);
  const roles = db.prepare('SELECT DISTINCT role FROM pattern_group_members ORDER BY role').all().map((row) => row.role);
  assert.ok(roles.includes('member') && roles.includes('drift'), roles.join(','));
});

const contains = (outer, inner) => outer.file === inner.file && outer.start <= inner.start && inner.end <= outer.end;

test('ranking: score = (instances - 1) * mass * (1 - holeRatio) * levelWeight, ranks 1..n over unfolded groups', () => {
  const swarm = bestFor('A21', (group) => group.path === 'N1-fp3' && group.kind === 'fn');
  const expected = (swarm.memberCount - 1) * swarm.mass * (1 - swarm.lgg.holeRatio) * LEVEL_WEIGHTS['N1-fp3'];
  assert.ok(Math.abs(swarm.score - expected) < 1e-9);
  const ranked = state.result.groups.filter((group) => group.rank !== null && group.rank !== undefined).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(ranked.map((group) => group.rank), ranked.map((_, index) => index + 1));
  assert.ok(ranked.every((group, index) => index === 0 || ranked[index - 1].score >= group.score));
  assert.equal(ranked.filter((group) => group.isSurfaced).length, Math.min(TOP_SURFACED, ranked.length));
});

test('maximality: a group inside a higher-scored group is folded into it (the savings-modal siblings into A24)', () => {
  const byId = new Map(state.result.groups.map((group) => [group.id, group]));
  const folded = state.result.groups.filter((group) => group.foldedInto);
  assert.ok(folded.length > 0);
  for (const group of folded) {
    const host = byId.get(group.foldedInto);
    assert.ok(host.score >= group.score);
    assert.ok(group.instances.every((instance) => host.instances.some((candidate) => contains(candidate, instance))));
  }
  const tiles = state.result.groups.find((group) => group.path === 'T' && anchorsCovered(group, 'A24') > 0);
  assert.ok(folded.some((group) => group.path === 'W' && group.kind === 'tmpl' && group.foldedInto === tiles.id));
});

test('dependsOn links a group to a lower-scored piece found inside every one of its instances', () => {
  const byId = new Map(state.result.groups.map((group) => [group.id, group]));
  const linked = state.result.groups.filter((group) => (group.dependsOn ?? []).length > 0);
  assert.ok(linked.length > 0);
  for (const group of linked) {
    for (const piece of group.dependsOn.map((id) => byId.get(id))) {
      assert.ok(piece.score < group.score);
      assert.ok(group.instances.every((instance) => piece.instances.some((candidate) => contains(instance, candidate))));
    }
  }
});

test('a warm run reuses the stored verdicts and gives the same groups', () => {
  const warm = runForgeGroups(state.sandbox.dir);
  const idsOf = (result) => result.groups.map((group) => group.id).sort();
  assert.deepEqual(idsOf(warm), idsOf(state.result));
  assert.deepEqual(warm.rejected.map((group) => group.rejectReason).sort(), state.result.rejected.map((group) => group.rejectReason).sort());
});

test('a suppression (patterns reject) holds over the next run: the group is suppressed, never surfaced', () => {
  const target = state.result.groups.find((group) => group.rank === 1);
  const db = state.sandbox.openDb();
  const found = findStoredGroup(db, target.id.slice(0, 8));
  assert.equal(found.group.id, target.id);
  suppressGroup(db, { group: found.group, reason: 'ground-truth spec: suppression round trip', agent: '@forge-p3b' });
  const next = runForgeGroups(state.sandbox.dir);
  assert.equal(next.groups.some((group) => group.id === target.id), false);
  const suppressed = next.suppressed.find((group) => group.id === target.id);
  assert.equal(suppressed.status, 'suppressed');
  assert.equal(suppressed.suppression.reason, 'ground-truth spec: suppression round trip');
  assert.equal(next.stats.rejectedByCode.suppressed, 1);
});
