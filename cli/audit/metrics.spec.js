// Ported from 711151d and 98c65c0: token burn charges each file against its own line budget.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTokenBurnAnalytics } from './metrics.js';

// metrics.js counts 36 characters as one line and 3.8 characters as one token.
const CHARS_PER_LINE = 36;
const tokensFor = (excessChars) => Math.round(excessChars / 3.8);
const excessTokensFor = (fileStats) => calculateTokenBurnAnalytics(fileStats).estimatedExcessTokens;
const fileOf = (lines, extra = {}) => ({ isMolecule: false, charCount: lines * CHARS_PER_LINE, ...extra });
const moleculeOf = (lines, extra = {}) => fileOf(lines, { isMolecule: true, ...extra });

describe('calculateTokenBurnAnalytics: the line budget of each file', () => {
  it('charges a 251-line molecule against its own lineBudget: 100 under atomic-strict, 250 under pragmatic', () => {
    assert.equal(excessTokensFor([moleculeOf(251, { lineBudget: 250 })]), tokensFor(1 * CHARS_PER_LINE));
    assert.equal(excessTokensFor([moleculeOf(251, { lineBudget: 100 })]), tokensFor(151 * CHARS_PER_LINE));
    assert.equal(excessTokensFor([moleculeOf(250, { lineBudget: 250 })]), 0);
  });

  it('charges a non-molecule against the 500-line file budget it carries', () => {
    assert.equal(excessTokensFor([fileOf(500, { lineBudget: 500 })]), 0);
    assert.equal(excessTokensFor([fileOf(501, { lineBudget: 500 })]), tokensFor(CHARS_PER_LINE));
  });

  it('falls back to the policy budgets when a fileStat has no lineBudget: 250 for a molecule, 500 otherwise', () => {
    assert.equal(excessTokensFor([moleculeOf(250)]), 0);
    assert.equal(excessTokensFor([moleculeOf(251)]), tokensFor(CHARS_PER_LINE));
    assert.equal(excessTokensFor([fileOf(500)]), 0);
    assert.equal(excessTokensFor([fileOf(501)]), tokensFor(CHARS_PER_LINE));
  });

  it('sums the excess over every file, and a codebase within budget stays at LOW risk', () => {
    const withinBudget = calculateTokenBurnAnalytics([moleculeOf(250, { lineBudget: 250 }), fileOf(400, { lineBudget: 500 })]);
    assert.deepEqual([withinBudget.estimatedExcessTokens, withinBudget.potentialSavingsPct, withinBudget.riskLevel], [0, 0, 'LOW']);
    const overBudget = [moleculeOf(250, { lineBudget: 100 }), fileOf(510, { lineBudget: 500 })];
    assert.equal(excessTokensFor(overBudget), tokensFor(160 * CHARS_PER_LINE));
  });
});
