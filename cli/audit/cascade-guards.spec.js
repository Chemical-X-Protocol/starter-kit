// CONTROL_FLOW_CASCADE_GUARDS (Directive 3.H) reports call-site bail-outs that protect an action,
// never the validator / resolver shape the directive prescribes as the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const RULE = 'CONTROL_FLOW_CASCADE_GUARDS';
const cascadeCount = (code) => auditCode(code, 'src/g.ts', 'src/g.ts', {}).filter((v) => v.rule === RULE).length;

test('cascade guards: three bail-outs before an action are reported', () => {
  const code = 'export function pay(isA, isB, isC) {\n  if (isA) return;\n  if (isB) return;\n  if (isC) throw new Error("no");\n  commit();\n}\n';
  assert.equal(cascadeCount(code), 1);
});

test('cascade guards: a validator returning reason codes is the prescribed shape, not a hazard', () => {
  const code = "export const refusal = (hasLease, isHolder, isLive) => {\n  if (!hasLease) return 'no_lease';\n  if (!isHolder) return 'not_holder';\n  if (!isLive) return 'expired';\n  return null;\n};\n";
  assert.equal(cascadeCount(code), 0);
});

test('cascade guards: a precedence resolver returning values is not a hazard', () => {
  const code = 'export const pick = (a, b, c) => {\n  if (a) return { id: a };\n  if (b) return { id: b };\n  if (c) return { id: c };\n  return { id: null };\n};\n';
  assert.equal(cascadeCount(code), 0);
});

test('cascade guards: bail-outs that end the block protect nothing and are not reported', () => {
  const code = 'export function stop(isA, isB, isC) {\n  run();\n  if (isA) return;\n  if (isB) return;\n  if (isC) return;\n}\n';
  assert.equal(cascadeCount(code), 0);
});
