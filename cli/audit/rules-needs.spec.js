/**
 * Every audit rule carries the minimum capability tier its FIX needs (light | standard | deep),
 * so a dispatcher can route cheap work to cheap models. The tier is fix difficulty, not severity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULE_REGISTRY, NEEDS_TIERS, DEFAULT_NEEDS, UNREGISTERED_RULE_NEEDS, resolveRuleNeeds } from './rules-registry.js';

const CLI_DIR = new URL('../', import.meta.url).pathname;

test('needs tiers are ordered light < standard < deep', () => {
  assert.deepEqual([...NEEDS_TIERS], ['light', 'standard', 'deep']);
});

test('every RULE_REGISTRY entry has a valid needs tier', () => {
  const invalid = Object.entries(RULE_REGISTRY).filter(([, meta]) => !NEEDS_TIERS.includes(meta.needs)).map(([rule]) => rule);
  assert.deepEqual(invalid, []);
});

test('calibration agreed with the user holds for the named rules', () => {
  const light = ['CONTROL_FLOW_INLINE_BOOLEAN', 'CONTROL_FLOW_NESTED_TERNARY', 'TYPOGRAPHY_EM_DASH', 'AI_SLOP_REDUNDANT_PASSTHROUGH', 'TYPE_COLOCATION', 'RAW_INLINE_STYLE', 'UNGUARDED_LOGGING'];
  const standard = ['ERROR_SWALLOWED_EXCEPTION', 'CONTROL_FLOW_SILENT_GUARD', 'DATA_FLOW_OPTIONAL_CHAINING_CHURN', 'TIMER_DISCIPLINE', 'HOOK_RETURN_OVERLOAD'];
  for (const rule of light) assert.equal(resolveRuleNeeds(rule), 'light', rule);
  for (const rule of standard) assert.equal(resolveRuleNeeds(rule), 'standard', rule);
  assert.equal(resolveRuleNeeds('LINE_BUDGET_FILE'), 'deep');
});

test('rules with the same fix share a tier; consumer-breaking reshapes are deep', () => {
  assert.equal(resolveRuleNeeds('RENDER_TREE_DEPTH_EXCEEDED'), resolveRuleNeeds('CONTROL_FLOW_NESTED_TERNARY'));
  assert.equal(resolveRuleNeeds('HOOK_SHAPE_CONTRACT'), 'deep');
});

test('the tier is fix difficulty, not severity: a CRITICAL ternary is light, a MEDIUM monolith is deep', () => {
  assert.equal(RULE_REGISTRY.CONTROL_FLOW_NESTED_TERNARY.severity, 'CRITICAL');
  assert.equal(resolveRuleNeeds('CONTROL_FLOW_NESTED_TERNARY'), 'light');
  assert.equal(RULE_REGISTRY.LINE_BUDGET_FILE.severity, 'MEDIUM');
  assert.equal(resolveRuleNeeds('LINE_BUDGET_FILE'), 'deep');
});

test('resolveRuleNeeds defaults unknown rules to standard', () => {
  assert.equal(DEFAULT_NEEDS, 'standard');
  assert.equal(resolveRuleNeeds('NOT_A_REAL_RULE'), 'standard');
  assert.equal(resolveRuleNeeds(undefined), 'standard');
});

test('rules emitted outside the audit engine have a recorded tier', () => {
  for (const [rule, needs] of Object.entries(UNREGISTERED_RULE_NEEDS)) {
    assert.ok(NEEDS_TIERS.includes(needs), rule);
    assert.equal(RULE_REGISTRY[rule], undefined, `${rule} is registered, drop it from UNREGISTERED_RULE_NEEDS`);
    assert.equal(resolveRuleNeeds(rule), needs);
  }
});

const listSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return listSources(full);
  const isSource = entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js');
  return isSource ? [full] : [];
});

test('every rule id emitted anywhere in cli/ is registered or has a recorded tier', () => {
  const emitted = new Set();
  for (const file of listSources(CLI_DIR)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const [, rule] of text.matchAll(/\brule:\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) emitted.add(rule);
  }
  const untiered = [...emitted].filter((rule) => !RULE_REGISTRY[rule] && !UNREGISTERED_RULE_NEEDS[rule]);
  assert.deepEqual(untiered, []);
});
