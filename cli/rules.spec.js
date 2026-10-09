import test from 'node:test';
import assert from 'node:assert/strict';
import * as jsRules from './rules.js';
import * as tsRules from '../hooks/rules.ts';

// The CLI runs cli/rules.js; hooks/rules.ts is a separate TS copy. Both run the same cases so they cannot drift.
const implementations = [['cli/rules.js', jsRules], ['hooks/rules.ts', tsRules]];

for (const [label, rules] of implementations) {
  const { ruleTree, evaluateRules, assertRuleTree, createRuleSet } = rules;

  test(`${label}: ruleTree collects every violation and the full tree without failFast`, () => {
    const gate = ruleTree({
      user: { missing: false, unverified: true },
      cart: { empty: true, stale: false }
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.first, 'user.unverified');
    assert.deepEqual(gate.violations, ['user.unverified', 'cart.empty']);
    assert.deepEqual(gate.tree, {
      user: { missing: false, unverified: true },
      cart: { empty: true, stale: false }
    });
  });

  test(`${label}: ruleTree passes when nothing fails`, () => {
    const gate = ruleTree({ a: { x: false, y: () => false } });
    assert.equal(gate.ok, true);
    assert.equal(gate.first, null);
    assert.deepEqual(gate.violations, []);
  });

  test(`${label}: failFast stops within a scope and leaves later keys out of the tree`, () => {
    let thunkCalls = 0;
    const gate = ruleTree({
      user: { missing: true, unverified: () => { thunkCalls += 1; return true; } }
    }, { failFast: true });
    assert.equal(gate.first, 'user.missing');
    assert.deepEqual(gate.violations, ['user.missing']);
    assert.equal(thunkCalls, 0);
    assert.deepEqual(gate.tree, { user: { missing: true } });
  });

  test(`${label}: failFast stops across scopes without calling later thunks`, () => {
    let thunkCalls = 0;
    const gate = ruleTree({
      user: { missing: true },
      cart: { empty: () => { thunkCalls += 1; return true; } }
    }, { failFast: true });
    assert.deepEqual(gate.violations, ['user.missing']);
    assert.equal(thunkCalls, 0);
    assert.deepEqual(gate.tree, { user: { missing: true } });
  });

  test(`${label}: without failFast every thunk runs`, () => {
    let thunkCalls = 0;
    const gate = ruleTree({
      user: { missing: true, unverified: () => { thunkCalls += 1; return true; } }
    });
    assert.equal(thunkCalls, 1);
    assert.deepEqual(gate.violations, ['user.missing', 'user.unverified']);
  });

  test(`${label}: evaluateRules honors failFast`, () => {
    let thunkCalls = 0;
    const all = evaluateRules({ a: true, b: () => true, c: false });
    assert.deepEqual(all, { ok: false, first: 'a', violations: ['a', 'b'] });
    const fast = evaluateRules({ a: true, b: () => { thunkCalls += 1; return true; } }, { failFast: true });
    assert.deepEqual(fast.violations, ['a']);
    assert.equal(thunkCalls, 0);
    assert.deepEqual(evaluateRules({ a: false }), { ok: true, first: null, violations: [] });
  });

  test(`${label}: assertRuleTree calls back with the first violation only on failure`, () => {
    const seen = [];
    assert.equal(assertRuleTree({ auth: { unauthorized: true, banned: true } }, (k) => seen.push(k)), false);
    assert.deepEqual(seen, ['auth.unauthorized']);
    assert.equal(assertRuleTree({ auth: { unauthorized: false } }, (k) => seen.push(k)), true);
    assert.deepEqual(seen, ['auth.unauthorized']);
    assert.equal(assertRuleTree({ auth: { unauthorized: true } }), false);
  });

  test(`${label}: createRuleSet reports the first failing predicate`, () => {
    const check = createRuleSet({ isPositive: (n) => n > 0, isEven: (n) => n % 2 === 0 });
    assert.deepEqual(check(2), { isValid: true, failingKey: null });
    assert.deepEqual(check(-2), { isValid: false, failingKey: 'isPositive' });
    assert.deepEqual(check(3), { isValid: false, failingKey: 'isEven' });
  });
}
