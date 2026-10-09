import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RULE_PRODUCT_PILLARS } from './rule-pillars.js';
import { RULE_REGISTRY } from './rules-registry.js';
import { PILLARS as PRODUCT_PILLARS } from '../pillars-schema.js';
import { auditCode } from './rules.js';
import { loadProjectConfig } from '../config/index.js';

const linesOf = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

test('every pillar-mapped rule exists and maps to a real product pillar', () => {
  const pillarKeys = new Set(PRODUCT_PILLARS.map((p) => p.key));
  for (const [rule, key] of Object.entries(RULE_PRODUCT_PILLARS)) {
    assert.ok(RULE_REGISTRY[rule], `${rule} is not a registry rule`);
    assert.ok(pillarKeys.has(key), `${rule} maps to unknown pillar ${key}`);
  }
});

test('disabling a product pillar removes its rules from the audit', () => {
  const rel = 'src/big.ts';
  const enabled = auditCode(linesOf(600), rel, rel, { config: { rules: {}, pillars: { lineBudgets: true } } });
  assert.equal(enabled.filter((v) => v.rule === 'LINE_BUDGET_FILE').length, 1);
  const disabled = auditCode(linesOf(600), rel, rel, { config: { rules: {}, pillars: { lineBudgets: false } } });
  assert.equal(disabled.filter((v) => v.rule === 'LINE_BUDGET_FILE').length, 0);
});

test('the pillar selection in .chemx/config.json is loaded next to .chemxrc', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-pillars-'));
  try {
    fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ profile: 'pragmatic' }));
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify({ pillars: { lineBudgets: false } }));
    assert.deepEqual(loadProjectConfig(root).pillars, { lineBudgets: false });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('violations carry the audit category and the product pillar as separate keys', () => {
  const big = Array.from({ length: 600 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  const budget = auditCode(big, '/p/src/big.ts', 'src/big.ts').find((v) => v.rule === 'LINE_BUDGET_FILE');
  assert.equal(budget.productPillar, 'lineBudgets');
  assert.equal(typeof budget.category, 'string');
  assert.equal(budget.pillar, budget.category, 'pillar stays as a deprecated alias of category');
  const ternary = auditCode('export const p = (a, b) => (a ? 1 : b ? 2 : 3);\n', '/p/src/t.ts', 'src/t.ts').find((v) => v.rule === 'CONTROL_FLOW_NESTED_TERNARY');
  assert.equal(ternary.productPillar, null);
  assert.equal(ternary.category, 'Control Flow & Boolean Logic');
});
