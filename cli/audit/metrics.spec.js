import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateTokenBurnAnalytics } from './metrics.js';
import { createSnapshotFromReport } from './history.js';

const CHARS_PER_LINE = 36;
const FILE_CHAR_BUDGET = 500 * CHARS_PER_LINE;

const MIXED_FILE_STATS = [
  { isMolecule: true, charCount: 5000 },
  { isMolecule: false, charCount: 1000 }
];

const excessTokensFor = (fileStats, options) => calculateTokenBurnAnalytics(fileStats, options).estimatedExcessTokens;

describe('calculateTokenBurnAnalytics: molecule budget follows the profile', () => {
  it('uses the default 250-line molecule budget when no options are given', () => {
    const analytics = calculateTokenBurnAnalytics(MIXED_FILE_STATS);
    assert.strictEqual(analytics.estimatedExcessTokens, 0);
    assert.strictEqual(analytics.potentialSavingsPct, 0);
    assert.strictEqual(analytics.riskLevel, 'LOW');
  });

  it('uses an explicit moleculeLineLimit of 100', () => {
    const analytics = calculateTokenBurnAnalytics(MIXED_FILE_STATS, { moleculeLineLimit: 100 });
    assert.strictEqual(analytics.estimatedExcessTokens, 368);
    assert.strictEqual(analytics.potentialSavingsPct, 23);
    assert.strictEqual(analytics.riskLevel, 'MODERATE');
  });

  it('resolves the limit from options.config when no explicit limit is passed', () => {
    const analytics = calculateTokenBurnAnalytics(MIXED_FILE_STATS, { config: { rules: { enforceFileLength: true } } });
    assert.strictEqual(analytics.estimatedExcessTokens, 368);
    assert.strictEqual(analytics.potentialSavingsPct, 23);
    assert.strictEqual(analytics.riskLevel, 'MODERATE');
  });

  it('charges only the characters above the 250-line default budget', () => {
    assert.strictEqual(excessTokensFor([{ isMolecule: true, charCount: 10000 }]), 263);
  });

  it('derives a 180-line molecule budget from moleculeLineLimit', () => {
    const budget = 180 * CHARS_PER_LINE;
    assert.strictEqual(excessTokensFor([{ isMolecule: true, charCount: budget }], { moleculeLineLimit: 180 }), 0);
    assert.strictEqual(excessTokensFor([{ isMolecule: true, charCount: budget + 38 }], { moleculeLineLimit: 180 }), 10);
  });

  it('keeps the 500-line budget for non-molecule files under every option', () => {
    const optionSets = [undefined, { moleculeLineLimit: 100 }, { moleculeLineLimit: 180 }, { config: { profile: 'atomic-strict' } }];
    for (const options of optionSets) {
      assert.strictEqual(excessTokensFor([{ isMolecule: false, charCount: FILE_CHAR_BUDGET }], options), 0);
      assert.strictEqual(excessTokensFor([{ isMolecule: false, charCount: FILE_CHAR_BUDGET + 38 }], options), 10);
    }
  });
});

describe('createSnapshotFromReport: molecule line limit', () => {
  const mockReport = {
    metrics: {
      scannedFiles: 2,
      totalLoc: 230,
      avgLoc: 115,
      moleculeCount: 2,
      moleculeCompliantCount: 2,
      moleculeCompliantPct: 100,
      hookCount: 0
    },
    health: { score: 100, grade: 'A+', label: 'Crystalline' },
    hotspots: [],
    violations: [],
    pillars: {},
    contextAnalysis: {}
  };

  it('records the molecule line limit the compliance figure was measured against', () => {
    const report = { ...mockReport, metrics: { ...mockReport.metrics, moleculeLineLimit: 250 } };
    assert.strictEqual(createSnapshotFromReport(report).metrics.moleculeLineLimit, 250);
  });

  it('leaves the limit undefined for reports produced before it existed', () => {
    assert.strictEqual(createSnapshotFromReport(mockReport).metrics.moleculeLineLimit, undefined);
  });
});
