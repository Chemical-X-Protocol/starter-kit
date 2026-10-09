import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMolecularHealthScore, calculateAiSlopScore, SCORE_MODEL } from './metrics.js';

const repeat = (n, violation) => Array.from({ length: n }, () => ({ ...violation }));

test('health score is intensive: the same density grades the same at any size', () => {
  for (const severity of ['CRITICAL', 'MEDIUM', 'LOW']) {
    const scores = [1, 10, 100].map((files) => calculateMolecularHealthScore(repeat(files, { severity, rule: 'X' }), files).score);
    assert.equal(new Set(scores).size, 1, `${severity}: ${scores.join(', ')}`);
  }
});

test('health reports the score model and the weighted density per file', () => {
  const health = calculateMolecularHealthScore(repeat(4, { severity: 'HIGH', rule: 'X' }), 2);
  assert.equal(health.scoreModel, SCORE_MODEL);
  assert.equal(SCORE_MODEL, 2);
  assert.equal(health.density, 8);
});

test('a clean codebase scores 100 and a dense one floors at 0', () => {
  assert.equal(calculateMolecularHealthScore([], 50).score, 100);
  assert.equal(calculateMolecularHealthScore(repeat(500, { severity: 'CRITICAL', rule: 'X' }), 5).score, 0);
});

test('AI slop score is intensive too', () => {
  const slop = { severity: 'HIGH', rule: 'AI_SLOP_SHALLOW_CATCH', isAiSlop: true };
  const scores = [1, 10, 100].map((files) => calculateAiSlopScore(repeat(files, slop), files).score);
  assert.equal(new Set(scores).size, 1);
});
