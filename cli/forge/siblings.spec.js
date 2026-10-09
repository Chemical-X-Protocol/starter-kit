// W (within-block siblings) on ground-truth items A1 and A19 (phases doc, P3 acceptance). Fixtures are
// verbatim copies: fixtures/team-flags.js.txt of cli/team/team-flags.js at commit 35c7798 and
// fixtures/social-gh.js.txt of cli/audit/social-gh.js at commit ffa231e. Each is written back to its repo
// path in a temp project, fingerprinted, and the W groups are scored against the labels: A1 is 13
// two-form flag pairs interleaved at :69-73, :100-104 and :123-124; A19 is four `gh discussion create`
// retries, three of them in sibling `if` blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFingerprints } from './fingerprint-sync.js';
import { openIndexDb } from '../search-schema.js';
import { readLedger, buildForgeGroups } from './forge-groups.js';
import { toScorerGroups } from './group-shape.js';
import { passesWFloor, W_FLOOR } from './siblings.js';
import { gtItems } from './gt-sandbox.js';
import { scoreGroups } from '../patterns/gt-score.js';

// Pins the opt-in inlining pass (off by default, #2595); the default-off mode is inline-mode.spec.js.
process.env.CHEMX_FORGE_INLINE = '1';

delete process.env.CHEMX_PROJECT_ROOT;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAGS_FILE = 'cli/team/team-flags.js';
const SOCIAL_FILE = 'cli/audit/social-gh.js';
const A1 = gtItems().find((item) => item.id === 'A1');
const A19 = gtItems().find((item) => item.id === 'A19');

const fixtureLedger = (t, fixture, repoPath) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-w-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, path.dirname(repoPath)), { recursive: true });
  fs.writeFileSync(path.join(dir, repoPath), fs.readFileSync(path.join(HERE, 'fixtures', fixture), 'utf-8'));
  syncFingerprints(dir, { targetDir: dir, log: () => {} });
  return { ledger: readLedger(openIndexDb(dir)), readFile: (file) => fs.readFileSync(path.join(dir, file), 'utf-8') };
};

const flagsLedger = (t) => fixtureLedger(t, 'team-flags.js.txt', FLAGS_FILE);

const coveredAnchors = (item, group) => item.anchors.filter((anchor) => group.instances.some((instance) => instance.startLine <= anchor.endLine && instance.endLine >= anchor.startLine)).length;
const coveredPairs = (group) => coveredAnchors(A1, group);

const bestW = (groups, kind = 'window') => groups.filter((group) => group.path === 'W' && group.kind === kind).sort((a, b) => coveredPairs(b) - coveredPairs(a))[0];

// Test double for the LGG of lgg.js: two forms unify when, string literals aside (L2 erases them), their
// anchors differ only by a parseInt(x, 10) wrapper, the transform hole of the int-flag variant.
const TRANSFORM_ANCHORS = new Set(['global:parseInt', 'num:10']);
const nonStringAnchors = (instance) => new Set(instance.anchors.filter((anchor) => !anchor.startsWith('str:')));
const unifyParseIntTransform = (a, b) => {
  const [left, right] = [nonStringAnchors(a), nonStringAnchors(b)];
  const difference = [...left].filter((anchor) => !right.has(anchor)).concat([...right].filter((anchor) => !left.has(anchor)));
  return difference.length > 0 && difference.every((anchor) => TRANSFORM_ANCHORS.has(anchor));
};

test('W finds the two-form string flags as non-contiguous siblings of one block', (t) => {
  const { ledger, readFile } = flagsLedger(t);
  const { groups } = buildForgeGroups(ledger, { readFile, unify: null });
  const best = bestW(groups);
  assert.ok(best.memberCount >= W_FLOOR.minInstances);
  assert.ok(coveredPairs(best) >= 5, `covers ${coveredPairs(best)} of 13 A1 pairs`);
  const gaps = best.instances.slice(1).map((instance, index) => instance.startLine - best.instances[index].endLine);
  assert.ok(gaps.some((gap) => gap > 2), 'other statements sit between the instances');
  assert.ok(best.instances.every((instance) => instance.file === FLAGS_FILE));
  const singles = bestW(groups, 'stmt');
  assert.ok(singles.memberCount > best.memberCount, 'the equals-only singles form a second, larger W bucket');
});

test('without a unify step the int and string forms stay apart, so A1 is only partial', (t) => {
  const { ledger, readFile } = flagsLedger(t);
  const report = scoreGroups([A1], toScorerGroups(buildForgeGroups(ledger, { readFile, unify: null }).groups));
  assert.equal(report.perItem[0].credit, 0.5);
});

test('the LGG unify step (the default) merges the int forms through a transform hole: >= 10 of 13 pairs', (t) => {
  const { ledger, readFile } = flagsLedger(t);
  const { groups } = buildForgeGroups(ledger, { readFile });
  const best = bestW(groups);
  assert.ok(coveredPairs(best) >= 10, `covers ${coveredPairs(best)} of 13 A1 pairs`);
  assert.equal(best.needsLgg, true);
  assert.ok(best.lgg.holes.some((hole) => hole.kind === 'transform'), 'parseInt(x, 10) is a transform hole');
  assert.deepEqual(best.rejectCodes, []);
  assert.equal(scoreGroups([A1], toScorerGroups([best])).perItem[0].credit, 1);
});

test('a unify step that accepts the parseInt transform merges W buckets to cover >= 10 of the 13 pairs', (t) => {
  const { ledger, readFile } = flagsLedger(t);
  const { groups } = buildForgeGroups(ledger, { readFile, unify: unifyParseIntTransform });
  const best = bestW(groups);
  assert.ok(coveredPairs(best) >= 10, `covers ${coveredPairs(best)} of 13 A1 pairs`);
  assert.equal(best.needsLgg, true);
  assert.equal(scoreGroups([A1], toScorerGroups([best])).perItem[0].credit, 1);
});

// Test double for the LGG: forms unify when, string literals aside, one side has a single extra imported
// binding (a ref hole: DISCUSSION_CATEGORY_SLUG where the other retries pass a string).
const unifySingleRef = (a, b) => {
  const [left, right] = [nonStringAnchors(a), nonStringAnchors(b)];
  const difference = [...left].filter((anchor) => !right.has(anchor)).concat([...right].filter((anchor) => !left.has(anchor)));
  return difference.length === 1 && difference[0].startsWith('import:');
};

test('W over sibling blocks reaches the A19 retries once the ref hole unifies them', (t) => {
  const { ledger, readFile } = fixtureLedger(t, 'social-gh.js.txt', SOCIAL_FILE);
  const plain = buildForgeGroups(ledger, { readFile, unify: null }).groups;
  assert.equal(scoreGroups([A19], toScorerGroups(plain)).perItem[0].credit, 0);
  const { groups } = buildForgeGroups(ledger, { readFile, unify: unifySingleRef });
  const retries = groups.filter((group) => group.path === 'W' && coveredAnchors(A19, group) >= 3);
  assert.ok(retries.length > 0);
  assert.ok(retries.every((group) => new Set(group.instances.map((instance) => instance.blockId)).size >= 2 || group.kind === 'stmt'));
  assert.equal(scoreGroups([A19], toScorerGroups(groups)).perItem[0].credit, 1);
});

test('the LGG unify step (the default) reaches the A19 retries across sibling blocks', (t) => {
  const { ledger, readFile } = fixtureLedger(t, 'social-gh.js.txt', SOCIAL_FILE);
  const { groups } = buildForgeGroups(ledger, { readFile });
  const retries = groups.filter((group) => group.path === 'W' && coveredAnchors(A19, group) >= 3);
  assert.ok(retries.length > 0);
  assert.equal(scoreGroups([A19], toScorerGroups(groups)).perItem[0].credit, 1);
});

test('the W floor needs 3 instances of mass >= 8 totalling >= 36', (t) => {
  const { ledger } = flagsLedger(t);
  const asInstance = (row) => ({ mass: row.mass });
  const heavy = ledger.rows.filter((row) => row.kind === 'stmt' && row.mass >= 12).slice(0, 3).map(asInstance);
  const light = ledger.rows.filter((row) => row.kind === 'stmt' && row.mass < W_FLOOR.minInstanceMass).slice(0, 1).map(asInstance);
  assert.equal(passesWFloor(heavy), true);
  assert.equal(passesWFloor(heavy.slice(0, 2)), false);
  assert.equal(passesWFloor([...heavy.slice(0, 2), ...light]), false);
});
