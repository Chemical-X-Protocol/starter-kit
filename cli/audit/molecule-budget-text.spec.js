// Ported from b0c0213 (reporter and social rows; prompts and roadmap keep main's
// describeLineBudgetPolicy wording).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReportMoleculeLineLimit } from './reporter-utils.js';
import { formatScorecardSection } from './reporter-sections.js';
import { formatPassesSection } from './reporter-summary.js';
import { formatGradeASection } from './reporter-grades.js';
import { generateDiscussionContent, generateTransformationDiscussionContent } from './social.js';
import { createSnapshotFromReport } from './history.js';

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => String(text).replace(ANSI_PATTERN, '');
const FIXED_100_CLAIM = /<\s*100\s*(lines|LOC)/;

const buildReport = (moleculeLineLimit, overrides = {}) => {
  const metrics = {
    scannedFiles: 5,
    totalLoc: 200,
    avgLoc: 40,
    largestFile: { filePath: 'src/a.ts', lineCount: 50 },
    moleculeCount: 2,
    moleculeCompliantCount: 2,
    moleculeCompliantPct: 100,
    hookCount: 1
  };
  if (moleculeLineLimit !== undefined) metrics.moleculeLineLimit = moleculeLineLimit;
  return {
    metrics,
    health: { score: 100, grade: 'A+', label: 'Pristine' },
    pillars: { 'Pillar 1': { status: 'PASSED', violations: 0, critical: 0, high: 0, medium: 0, low: 0 } },
    hotspots: [],
    contextAnalysis: { riskLevel: 'LOW', estimatedTokens: 1000, estimatedExcessTokens: 0, potentialSavingsPct: 0 },
    violations: [],
    aiSlop: { score: 100, grade: 'A+', label: 'Pure Artisanal' },
    ...overrides
  };
};

const LIMIT_CASES = [
  { label: 'pragmatic limit 250', limit: 250, expected: 250 },
  { label: 'atomic-strict limit 100', limit: 100, expected: 100 },
  { label: 'report without the field', limit: undefined, expected: 250 }
];

const assertDerivedLimitText = (text, pattern) => {
  const plain = stripAnsi(text);
  assert.ok(plain.includes(pattern), `expected "${pattern}" in:\n${plain}`);
  assert.doesNotMatch(plain, FIXED_100_CLAIM);
  assert.ok(!plain.includes('undefined'), 'report text must not print undefined');
};

describe('resolveReportMoleculeLineLimit', () => {
  it('reads metrics.moleculeLineLimit and falls back to the default budget', () => {
    assert.equal(resolveReportMoleculeLineLimit({ metrics: { moleculeLineLimit: 180 } }), 180);
    assert.equal(resolveReportMoleculeLineLimit({ metrics: {} }), 250);
    assert.equal(resolveReportMoleculeLineLimit(undefined), 250);
  });
});

describe('report text prints the profile molecule limit', () => {
  for (const { label, limit, expected } of LIMIT_CASES) {
    it(`scorecard, grade A and passes sections (${label})`, () => {
      const report = buildReport(limit);
      assertDerivedLimitText(formatScorecardSection(report), `compliant <= ${expected} lines of code`);
      const gradeA = formatGradeASection(report);
      assertDerivedLimitText(gradeA, `compliant (<= ${expected} lines of code)`);
      assertDerivedLimitText(gradeA, `(<= ${expected} lines per molecule)`);
      const passes = formatPassesSection(report);
      assertDerivedLimitText(passes, `compliant (<= ${expected} lines of code)`);
      assertDerivedLimitText(passes, `(<= ${expected} lines per molecule)`);
    });

    it(`teardown and transformation discussion bodies (${label})`, () => {
      const lowScoring = buildReport(limit, { health: { score: 55, grade: 'D', label: 'Degraded' } });
      assertDerivedLimitText(generateDiscussionContent(lowScoring, 'dev', 'acme/app').body, `(<= ${expected} lines of code)`);
      const before = createSnapshotFromReport(buildReport(limit, { health: { score: 40, grade: 'F', label: 'Critical' } }));
      const after = createSnapshotFromReport(buildReport(limit));
      const transformation = generateTransformationDiscussionContent(before, after, 'dev', 'acme/app');
      assertDerivedLimitText(transformation.body, `(<= ${expected} lines of code)`);
    });
  }
});
