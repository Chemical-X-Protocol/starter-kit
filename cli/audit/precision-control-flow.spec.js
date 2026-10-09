import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const CONTROL_FLOW_RULES = new Set(['CONTROL_FLOW_INLINE_BOOLEAN', 'CONTROL_FLOW_SILENT_GUARD']);
const controlFlow = (violations) => violations.filter((v) => CONTROL_FLOW_RULES.has(v.rule));
const audit = (code, rel = 'src/lib/sample.ts') => auditCode(code, rel, rel);

// Golden examples copied verbatim from AGENTS.md 3.A, 3.B, 3.C and 2.C ("must pass").
const GOLDEN_3A = `
const handleCheckout = () => {
  // Stage 1: atomic concepts (Layer 1/2 predicates from 3.B where they exist)
  const hasSufficientFunds = userBalance >= totalCost;
  const isFormComplete = isAddressValid && hasAcceptedTerms;
  // Stage 2: the decision
  const canCheckout = hasItems(cart) && isFormComplete && hasSufficientFunds && !isProcessing;
  if (!canCheckout) return;
  processPayment();
};
const exceedsHookBudget = hookCount > 5;
if (exceedsHookBudget) report();
`;

const GOLDEN_3B = `
const isTierFile = (file, tier) => {
  const isSrc = file.path.startsWith("src/");
  if (!isSrc) return false;
  return file.path.includes(\`\${tier}/\`) || file.tier === tier;
};
`;

const GOLDEN_3C = `
const handleAction = async (id) => {
  if (!canProceed.value) return;
  triggerHapticFeedback();
  recordTelemetryMetric('action:trigger', { id });
  await executeServiceCall(id);
  dismissActiveModal();
};
`;

const GOLDEN_2C = `
export async function load(id) {
  const [data, fetchError] = await toResult(api.fetchEntity(id));
  if (fetchError) {
    handleError(fetchError);
    return;
  }
  initializeEntity(data);
}
`;

test('AGENTS.md golden control-flow examples pass the audit', () => {
  for (const code of [GOLDEN_3A, GOLDEN_3B, GOLDEN_3C, GOLDEN_2C]) {
    assert.deepEqual(controlFlow(audit(code)), []);
  }
});

test('AGENTS.md 3.A counter-example (the if asks) is flagged', () => {
  const code = 'export function gate(hookCount) {\n  if (hookCount > 5) return;\n  run();\n}\n';
  const hits = audit(code).filter((v) => v.rule === 'CONTROL_FLOW_INLINE_BOOLEAN');
  assert.equal(hits.length, 1);
});

test('3.A is literal: raw comparisons and compound logic fail, named or negated names pass', () => {
  const failing = ['a && b', 'x === y', '!a || !b', 'RE.test(s)', 'fs.existsSync(p)'];
  for (const testExpr of failing) {
    const code = `export function f(a, b, x, y, s, p, RE, fs) {\n  if (${testExpr}) run();\n}\n`;
    const hits = audit(code).filter((v) => v.rule === 'CONTROL_FLOW_INLINE_BOOLEAN');
    assert.equal(hits.length, 1, `expected a violation for if (${testExpr})`);
  }
  const passing = ['isReady', '!isReady', 'state.isReady', 'hasItems(cart)', 'store.canSave()', '!canProceed.value'];
  for (const testExpr of passing) {
    const code = `export function f(isReady, state, cart, store, canProceed) {\n  if (${testExpr}) run();\n}\n`;
    const hits = audit(code).filter((v) => v.rule === 'CONTROL_FLOW_INLINE_BOOLEAN');
    assert.equal(hits.length, 0, `expected no violation for if (${testExpr})`);
  }
});

test('a silent bare return on an error-ish condition is still flagged by 3.G', () => {
  const code = 'export async function handleSave(response) {\n  const hasFailed = !response.ok;\n  if (hasFailed) return;\n  commit();\n}\n';
  const hits = audit(code).filter((v) => v.rule === 'CONTROL_FLOW_SILENT_GUARD');
  assert.equal(hits.length, 1);
});
