// W (within-block siblings) on ground-truth item A1 (phases doc, P3 acceptance). The fixture
// fixtures/team-flags.js.txt is a verbatim copy of cli/team/team-flags.js at commit 35c7798; it is
// written back to cli/team/team-flags.js in a temp project, fingerprinted, and the W groups are scored
// against the A1 labels (13 two-form flag pairs, interleaved at :69-73, :100-104 and :123-124).
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

delete process.env.CHEMX_PROJECT_ROOT;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAGS_FILE = 'cli/team/team-flags.js';
const A1 = gtItems().find((item) => item.id === 'A1');

const flagsLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-w-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, 'cli', 'team'), { recursive: true });
  const text = fs.readFileSync(path.join(HERE, 'fixtures', 'team-flags.js.txt'), 'utf-8');
  fs.writeFileSync(path.join(dir, FLAGS_FILE), text);
  syncFingerprints(dir, { targetDir: dir, log: () => {} });
  return { ledger: readLedger(openIndexDb(dir)), readFile: (file) => fs.readFileSync(path.join(dir, file), 'utf-8') };
};

const coveredPairs = (group) => A1.anchors.filter((anchor) => group.instances.some((instance) => instance.startLine <= anchor.endLine && instance.endLine >= anchor.startLine)).length;

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
  const { groups } = buildForgeGroups(ledger, { readFile });
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
  const report = scoreGroups([A1], toScorerGroups(buildForgeGroups(ledger, { readFile }).groups));
  assert.equal(report.perItem[0].credit, 0.5);
});

test('a unify step that accepts the parseInt transform merges W buckets to cover >= 10 of the 13 pairs', (t) => {
  const { ledger, readFile } = flagsLedger(t);
  const { groups } = buildForgeGroups(ledger, { readFile, unify: unifyParseIntTransform });
  const best = bestW(groups);
  assert.ok(coveredPairs(best) >= 10, `covers ${coveredPairs(best)} of 13 A1 pairs`);
  assert.equal(best.needsLgg, true);
  assert.equal(scoreGroups([A1], toScorerGroups([best])).perItem[0].credit, 1);
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
