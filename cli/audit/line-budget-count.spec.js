import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const fileOf = (n) => `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`;
const budgetHits = (content) => auditCode(content, '/p/src/big.js', 'src/big.js').filter((v) => v.rule === 'LINE_BUDGET_FILE');

// Editors, chemx read and the patch guardrails count 'a\n' as one line; the audit must agree.
test('audit line budget: a final newline is not an extra line', () => {
  assert.equal(budgetHits(fileOf(500)).length, 0, '500 lines plus a final newline is within the 500-line budget');
  const over = budgetHits(fileOf(501));
  assert.equal(over.length, 1);
  assert.match(over[0].hazard, /\(501 > 500 lines\)/);
});
