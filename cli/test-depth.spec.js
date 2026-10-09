import test from 'node:test';
import assert from 'node:assert/strict';
import { reasonHops, parseDepth, limitDepth } from './test-depth.js';
import { describeSelection } from './test-report.js';

const scopeOf = (specs) => ({
  targets: specs.map((spec) => spec.path),
  filter: null,
  selection: { mode: 'affected', reason: null, specs, unaffected: [], suiteSize: 10, changed: ['cli/x.js'] }
});

const NEAR = { path: 'cli/near.spec.js', reasons: ['depends on cli/x.js <- cli/near.spec.js'] };
const FAR = { path: 'cli/far.spec.js', reasons: ['depends on cli/x.js <- cli/a.js <- cli/b.js <- cli/far.spec.js'] };
const SELF = { path: 'cli/x.spec.js', reasons: ['colocated with cli/x.js'] };
const COMPUTED = { path: 'cli/computed.spec.js', reasons: ['may load any changed file: cli/h.js loads modules by a computed path; depends on cli/h.js <- cli/computed.spec.js'] };

test('test-depth: hops are the import links in the reason; a colocated spec is 0; a computed import is never bounded', () => {
  assert.equal(reasonHops('changed'), 0);
  assert.equal(reasonHops(SELF.reasons[0]), 0);
  assert.equal(reasonHops(NEAR.reasons[0]), 1);
  assert.equal(reasonHops(FAR.reasons[0]), 3);
  assert.equal(reasonHops(COMPUTED.reasons[0]), Number.POSITIVE_INFINITY);
});

test('test-depth: parseDepth accepts non-negative integers only', () => {
  assert.equal(parseDepth('2'), 2);
  assert.equal(parseDepth('0'), 0);
  assert.equal(parseDepth(undefined), null);
  assert.equal(parseDepth('-1'), null);
  assert.equal(parseDepth('two'), null);
  assert.equal(parseDepth('1.5'), null);
});

test('test-depth: --depth keeps the near specs and lists the deeper ones as not run', () => {
  const result = limitDepth(scopeOf([SELF, NEAR, FAR, COMPUTED]), 1);
  assert.deepEqual(result.targets, ['cli/x.spec.js', 'cli/near.spec.js']);
  assert.deepEqual(result.selection.beyondDepth, ['cli/far.spec.js', 'cli/computed.spec.js']);
  assert.equal(result.selection.depth, 1);
  assert.equal(result.emptyDetail, undefined);
});

test('test-depth: a spec reached both by a short chain and a long one counts by the short one', () => {
  const both = { path: 'cli/both.spec.js', reasons: [FAR.reasons[0], NEAR.reasons[0]] };
  assert.deepEqual(limitDepth(scopeOf([both]), 1).targets, ['cli/both.spec.js']);
});

test('test-depth: nothing within reach is an empty run that says how many deeper specs were skipped', () => {
  const result = limitDepth(scopeOf([FAR]), 1);
  assert.deepEqual(result.targets, []);
  assert.match(result.emptyDetail, /no affected spec is within 1 import hop.*1 deeper spec.*drop --depth/);
});

test('test-depth: no depth, a full run and explicit targets pass through untouched', () => {
  const affected = scopeOf([NEAR, FAR]);
  assert.equal(limitDepth(affected, null), affected);
  const full = { targets: [], filter: null, selection: { mode: 'full', reason: 'package.json changed', specs: [], unaffected: [] } };
  assert.equal(limitDepth(full, 1), full);
  const explicit = { targets: ['cli/a.spec.js'], filter: null, selection: null };
  assert.equal(limitDepth(explicit, 1), explicit);
});

test('test-depth: the selection line says a depth-limited run is not proof', () => {
  const result = limitDepth(scopeOf([SELF, NEAR, FAR]), 1);
  const line = describeSelection(result.selection);
  assert.match(line, /--depth=1: 1 deeper spec\(s\) NOT run, so this is not proof/);
});
