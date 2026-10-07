import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveReportMoleculeLineLimit } from './reporter-utils.js';
import { formatScorecardSection } from './reporter-sections.js';
import { formatPassesSection } from './reporter-summary.js';
import { formatGradeASection } from './reporter-grades.js';
import {
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildHotspotsPrompt,
  buildPillarPrompt
} from './prompts.js';
import { buildRemediationRoadmap, buildSelfHealingRoadmapPrompt } from './roadmap.js';
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

const buildHotspot = (lineCount) => ({
  filePath: `src/views/Monolith${lineCount}.vue`,
  lineCount,
  violationCount: 3,
  isMonolith: true
});

const LIMIT_CASES = [
  { label: 'pragmatic limit 250', limit: 250, expected: 250 },
  { label: 'atomic-strict limit 100', limit: 100, expected: 100 },
  { label: 'custom limit 180', limit: 180, expected: 180 },
  { label: 'report without the field', limit: undefined, expected: 250 }
];

const assertDerivedLimitText = (text, expected, pattern) => {
  const plain = stripAnsi(text);
  assert.ok(plain.includes(pattern), `expected "${pattern}" in:\n${plain}`);
  assert.doesNotMatch(plain, FIXED_100_CLAIM);
  assert.ok(!plain.includes('undefined'), 'report text must not print undefined');
};

describe('resolveReportMoleculeLineLimit', () => {
  it('reads metrics.moleculeLineLimit from the report', () => {
    assert.strictEqual(resolveReportMoleculeLineLimit({ metrics: { moleculeLineLimit: 180 } }), 180);
  });

  it('falls back to the default 250-line budget for older or partial reports', () => {
    assert.strictEqual(resolveReportMoleculeLineLimit({ metrics: {} }), 250);
    assert.strictEqual(resolveReportMoleculeLineLimit({}), 250);
    assert.strictEqual(resolveReportMoleculeLineLimit(undefined), 250);
  });
});

describe('terminal report sections print the profile molecule limit', () => {
  for (const { label, limit, expected } of LIMIT_CASES) {
    it(`scorecard, grade A and passes sections (${label})`, () => {
      const report = buildReport(limit);
      assertDerivedLimitText(formatScorecardSection(report), expected, `compliant <= ${expected} lines of code`);
      const gradeA = formatGradeASection(report);
      assertDerivedLimitText(gradeA, expected, `compliant (<= ${expected} lines of code)`);
      assertDerivedLimitText(gradeA, expected, `(<= ${expected} lines per molecule)`);
      const passes = formatPassesSection(report);
      assertDerivedLimitText(passes, expected, `compliant (<= ${expected} lines of code)`);
      assertDerivedLimitText(passes, expected, `(<= ${expected} lines per molecule)`);
    });
  }
});

describe('agent prompts print the profile molecule limit', () => {
  for (const { label, limit, expected } of LIMIT_CASES) {
    it(`grade F, grade D, hotspot and pillar prompts (${label})`, () => {
      const gradeF = buildGradeFPrompt(buildReport(limit, { hotspots: [buildHotspot(2400)] }));
      assertDerivedLimitText(gradeF, expected, `(<= ${expected} lines per molecule)`);
      assertDerivedLimitText(gradeF, expected, `must stay within ${expected} lines`);

      const gradeD = buildGradeDPrompt(buildReport(limit, { hotspots: [buildHotspot(1200)] }));
      assertDerivedLimitText(gradeD, expected, `(<= ${expected} lines of code)`);

      const hotspotsPrompt = buildHotspotsPrompt(buildReport(limit, { hotspots: [buildHotspot(640)] }));
      assertDerivedLimitText(hotspotsPrompt, expected, `(<= ${expected} lines)`);
      assertDerivedLimitText(hotspotsPrompt, expected, `within ${expected} lines per file`);

      const pillarReport = buildReport(limit, { hotspots: [buildHotspot(640)] });
      const pillarPrompt = buildPillarPrompt(pillarReport, 'Line Budgets & Monolith Decomposition');
      assertDerivedLimitText(pillarPrompt, expected, `(<= ${expected} lines)`);
      assertDerivedLimitText(pillarPrompt, expected, `Maximum ${expected} lines per molecule capsule file`);
    });
  }

  it('drops the invented type-file line cap from the grade C prompt', () => {
    const gradeC = buildGradeCPrompt(buildReport(250, { hotspots: [buildHotspot(640)] }));
    assert.ok(gradeC.includes('Co-locate granular types'));
    assert.doesNotMatch(gradeC, FIXED_100_CLAIM);
  });
});

describe('remediation roadmap prints the profile molecule limit', () => {
  for (const { label, limit, expected } of LIMIT_CASES) {
    it(`phase actions and the self-healing prompt (${label})`, () => {
      const report = buildReport(limit, { hotspots: [buildHotspot(640)] });
      const actions = buildRemediationRoadmap(report).flatMap((p) => p.items).map((i) => i.action);
      const decomposeAction = actions.find((action) => action.startsWith('Decompose into crystalline'));
      assert.ok(decomposeAction, `expected a Phase 3 decompose action in ${JSON.stringify(actions)}`);
      assert.ok(decomposeAction.includes(`(<= ${expected} lines per molecule)`), decomposeAction);
      for (const action of actions) {
        assert.doesNotMatch(action, FIXED_100_CLAIM);
      }
      const prompt = buildSelfHealingRoadmapPrompt(report);
      assertDerivedLimitText(prompt, expected, `must stay within ${expected} lines`);
    });
  }
});

describe('community discussion posts print the profile molecule limit', () => {
  for (const { label, limit, expected } of LIMIT_CASES) {
    it(`teardown and transformation bodies (${label})`, () => {
      const lowScoring = buildReport(limit, { health: { score: 55, grade: 'D', label: 'Degraded' } });
      const teardown = generateDiscussionContent(lowScoring, 'dev', 'acme/app');
      assertDerivedLimitText(teardown.body, expected, `(<= ${expected} lines of code)`);

      const beforeSnapshot = createSnapshotFromReport(buildReport(limit, { health: { score: 40, grade: 'F', label: 'Critical' } }));
      const afterSnapshot = createSnapshotFromReport(buildReport(limit));
      const transformation = generateTransformationDiscussionContent(beforeSnapshot, afterSnapshot, 'dev', 'acme/app');
      assertDerivedLimitText(transformation.body, expected, `(<= ${expected} lines of code)`);
    });
  }
});
