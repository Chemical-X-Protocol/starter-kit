import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRuleOverrides } from './rule-overrides.js';

const registry = { SYNTHETIC_DEFAULT_OFF: { isDefaultOff: true }, SYNTHETIC_ON: {} };
const found = () => [
  { rule: 'SYNTHETIC_DEFAULT_OFF', severity: 'HIGH', line: 1 },
  { rule: 'SYNTHETIC_DEFAULT_OFF', severity: 'MEDIUM', line: 2 }
];
const severities = (result) => result.map((v) => v.severity);
const apply = (config, path = 'a.txt', options = {}) => applyRuleOverrides(found(), path, config, { registry, ...options });

test('a default-off registry entry is silent when no setting names it', () => {
  assert.deepEqual(apply({}), []);
});

test('"on" and true enable the rule and keep engine severities', () => {
  assert.deepEqual(severities(apply({ rules: { SYNTHETIC_DEFAULT_OFF: 'on' } })), ['HIGH', 'MEDIUM']);
  assert.deepEqual(severities(apply({ rules: { SYNTHETIC_DEFAULT_OFF: true } })), ['HIGH', 'MEDIUM']);
});

test('a severity enables the rule and overwrites both severities', () => {
  assert.deepEqual(severities(apply({ rules: { SYNTHETIC_DEFAULT_OFF: 'medium' } })), ['MEDIUM', 'MEDIUM']);
});

test('"off" still drops the rule', () => {
  assert.deepEqual(apply({ rules: { SYNTHETIC_DEFAULT_OFF: 'off' } }), []);
});

test('an overrides glob enables a default-off rule for matching files only', () => {
  const config = { overrides: [{ files: 'src/**', rules: { SYNTHETIC_DEFAULT_OFF: 'on' } }] };
  assert.equal(apply(config, 'src/a.txt').length, 2);
  assert.equal(apply(config, 'lib/a.txt').length, 0);
});

test('a caller-supplied defaultOff set behaves like isDefaultOff', () => {
  const violations = [{ rule: 'SYNTHETIC_ON', severity: 'HIGH' }];
  const defaultOff = new Set(['SYNTHETIC_ON']);
  assert.deepEqual(applyRuleOverrides(violations, 'a.txt', {}, { registry, defaultOff }), []);
  assert.equal(applyRuleOverrides(violations, 'a.txt', { rules: { SYNTHETIC_ON: 'on' } }, { registry, defaultOff }).length, 1);
  assert.equal(applyRuleOverrides(violations, 'a.txt', {}, { registry }).length, 1);
});
