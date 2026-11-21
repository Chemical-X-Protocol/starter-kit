import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initCallSchema } from './telemetry/call-schema.js';
import { readBoardSavings } from './ui-savings.js';

test('ui-savings: no ledger reports no data instead of inventing a baseline', () => {
  assert.deepEqual(readBoardSavings(new DatabaseSync(':memory:')), { success: true, hasData: false });
});

test('ui-savings: gross counts only calls with a counterfactual; net subtracts the rest', () => {
  const db = new DatabaseSync(':memory:'); initCallSchema(db);
  const add = db.prepare('INSERT INTO tool_calls (ts, surface, action, result_chars, cf_kind, cf_chars) VALUES (?, ?, ?, ?, ?, ?)');
  add.run(1, 'cli', 'read', 400, 'file-whole', 4000);
  add.run(2, 'cli', 'team', 800, null, 0);
  const s = readBoardSavings(db);
  assert.equal(s.hasData, true);
  assert.deepEqual([s.since, s.until], [1, 2]);
  assert.equal(s.totals.grossSavedTokens, 900);
  assert.equal(s.totals.netSavedTokens, 700);
  assert.equal(s.totals.measuredReturnedTokens, 100);
  assert.equal(s.totals.counterfactualTokens, 1000);
  assert.deepEqual(s.topActions.map((a) => a.action), ['read']);
});
