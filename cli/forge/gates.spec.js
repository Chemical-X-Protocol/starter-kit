// Gates G1-G4, the instance rules, the idiom label and per-facet ubiquity (engine doc section 4), plus the
// own-return test that keeps mid-block returns out of statement pieces (exits.js). Snippets are read from
// the P1 ground-truth fixtures, verbatim excerpts with file:line provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkGate, admitGroup, isIdiom, createUbiquityIndex, GATES, GATE_OF_PATH } from './gates.js';
import { hasOwnReturn } from './exits.js';
import { parseFixture } from '../patterns/gt-text.js';
import { GT_DIR } from './gt-sandbox.js';

const excerpt = (anchorId) => {
  const itemId = anchorId.split('.')[0];
  const entries = parseFixture(fs.readFileSync(path.join(GT_DIR, `${itemId}.txt`), 'utf-8'));
  return entries.find((entry) => entry.id === anchorId).lines;
};

const metrics = (mass, anchorWeight) => ({ mass, anchorWeight, evidence: mass + 3 * anchorWeight });

test('each gate holds exactly at its thresholds', () => {
  assert.equal(checkGate('G1', metrics(8, 10 / 3)).ok, true);
  assert.equal(checkGate('G1', metrics(7, 10)).first, 'lowMass');
  assert.equal(checkGate('G1', metrics(9, 2)).first, 'lowEvidence');
  assert.equal(checkGate('G2', metrics(24, 2)).ok, true);
  assert.equal(checkGate('G2', metrics(40, 1.5)).first, 'lowAnchorWeight');
  assert.equal(checkGate('G2', metrics(20, 3)).first, 'lowEvidence');
  assert.equal(checkGate('G3', metrics(GATES.G3.minMass, 4)).ok, true);
  assert.equal(checkGate('G3', metrics(39, 20)).first, 'lowMass');
  assert.equal(checkGate('G4', metrics(10, 0)).ok, true);
  assert.equal(checkGate('G4', metrics(9, 0)).first, 'lowMass');
});

test('every path names its gate; W keeps its own floor', () => {
  assert.deepEqual(GATE_OF_PATH, { 'N1-fp1': 'G1', 'N1-fp2': 'G2', 'N1-fp3': 'G3', N2: 'G2', N3: 'G1', T: 'G4', W: null });
});

const group = (overrides) => ({ path: 'N1-fp1', kind: 'stmt', memberCount: 3, fileCount: 2, ...metrics(12, 2.5), ...overrides });

test('a cross-file group needs 2 files, and a 2-instance one needs G2 or G1 with anchorWeight >= 3', () => {
  assert.deepEqual(admitGroup(group({})), { ok: true, reason: null });
  assert.equal(admitGroup(group({ fileCount: 1 })).reason, 'instances.singleFile');
  assert.equal(admitGroup(group({ memberCount: 2 })).reason, 'instances.weakPair');
  assert.equal(admitGroup(group({ memberCount: 2, ...metrics(12, 3) })).ok, true);
  assert.equal(admitGroup(group({ path: 'N1-fp2', memberCount: 2, ...metrics(24, 2) })).ok, true);
  assert.equal(admitGroup(group({ path: 'N1-fp2' })).reason, 'G2.lowEvidence');
});

test('a template group needs 3 instances in 2 files and G4', () => {
  const tile = group({ path: 'T', kind: 'tmpl', ...metrics(11, 0) });
  assert.equal(admitGroup(tile).ok, true);
  assert.equal(admitGroup({ ...tile, memberCount: 2 }).reason, 'instances.tooFewInstances');
  assert.equal(admitGroup({ ...tile, ...metrics(9, 0) }).reason, 'G4.lowMass');
});

test('an expr group of more than 25 instances over more than 10 directories with E < 35 is an idiom', () => {
  const instances = Array.from({ length: 26 }, (_, index) => ({ file: `pkg${index % 11}/file.js` }));
  const common = { kind: 'expr', memberCount: 26, instances, ...metrics(14, 6) };
  assert.equal(isIdiom(common), true);
  assert.equal(isIdiom({ ...common, ...metrics(14, 7) }), false);
  assert.equal(isIdiom({ ...common, kind: 'stmt' }), false);
  assert.equal(isIdiom({ ...common, instances: instances.map((instance) => ({ file: `pkg${instance.file.length % 10}/file.js` })) }), false);
});

test('ubiquity is per facet: an anchor in more than 40% of the facet files weighs nothing there', () => {
  const rows = [
    ...['a.js', 'b.js', 'c.js'].map((file) => ({ file_path: file, facet_key: 'js:plain:src:.', anchors: ['call:join', 'global:JSON'] })),
    ...['d.js', 'e.js'].map((file) => ({ file_path: file, facet_key: 'js:plain:src:.', anchors: ['call:join'] })),
    { file_path: 'f.ts', facet_key: 'ts:vue:src:.', anchors: ['call:join'] },
    ...['g.ts', 'h.ts', 'i.ts'].map((file) => ({ file_path: file, facet_key: 'ts:vue:src:.', anchors: ['global:JSON'] }))
  ];
  const ubiquitousOf = createUbiquityIndex(rows);
  assert.deepEqual([...ubiquitousOf('js:plain:src:.')].sort(), ['call:join', 'global:JSON']);
  assert.deepEqual([...ubiquitousOf('ts:vue:src:.')], ['global:JSON']);
  assert.deepEqual([...ubiquitousOf('js:react:src:.')], []);
});

test('own returns: a guard return counts, a return inside a nested callback does not', () => {
  const guard = excerpt('C1.1')[2];
  assert.match(guard, /if \(isString\) return/);
  assert.equal(hasOwnReturn(guard), true);
  const poller = excerpt('A22.1').join('\n');
  assert.match(poller, /return;/);
  assert.equal(hasOwnReturn(poller), false);
  assert.equal(hasOwnReturn(excerpt('A7.1').slice(1, -1).join('\n')), true);
});
