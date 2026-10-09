import test from 'node:test';
import assert from 'node:assert/strict';
import { compactViolationLists } from './tools-patch.js';

const v = { rule: 'R1', line: 4, severity: 'HIGH', hazard: 'h', directive: 'd', pillar: 'p' };
const result = { file: 'a.js', violations: [v], introducedViolations: [v], preExistingViolations: [] };

test('compactViolationLists prints rule text once and lists rule@line', () => {
  const out = compactViolationLists(result);
  assert.deepEqual(out.violations, ['R1@4']);
  assert.deepEqual(out.introducedViolations, ['R1@4']);
  assert.deepEqual(out.preExistingViolations, []);
  assert.equal(out.rules.R1.hazard, 'h');
});

test('compactViolationLists keeps the full shape with full:true or compact:false', () => {
  assert.equal(compactViolationLists(result, { full: true }), result);
  assert.equal(compactViolationLists(result, { compact: false }), result);
});
