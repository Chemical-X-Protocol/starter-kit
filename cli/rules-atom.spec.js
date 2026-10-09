import test from "node:test";
import assert from "node:assert/strict";
import { ruleTree, evaluateRules, assertRuleTree } from "../hooks/rules.ts";

test("hooks/rules: ruleTree evaluates branches and compiles dual-mode tree", () => {
  const gate = ruleTree({
    user: { missing: false, unverified: true },
    cart: { empty: false }
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.first, "user.unverified");
  assert.deepEqual(gate.violations, ["user.unverified"]);
  assert.deepEqual(gate.tree, {
    user: { missing: false, unverified: true },
    cart: { empty: false }
  });
});

test("hooks/rules: ruleTree short-circuits lazy thunk on earlier failure", () => {
  let thunkCalled = false;
  const gate = ruleTree({
    user: {
      missing: true,
      unverified: () => { thunkCalled = true; return true; }
    }
  }, { failFast: true });

  assert.equal(gate.ok, false);
  assert.equal(gate.first, "user.missing");
  assert.equal(thunkCalled, false);
});

test("hooks/rules: assertRuleTree executes callback with first violation on failure", () => {
  let callbackKey = null;
  const ok = assertRuleTree({
    auth: { unauthorized: true }
  }, (k) => { callbackKey = k; });

  assert.equal(ok, false);
  assert.equal(callbackKey, "auth.unauthorized");
});
