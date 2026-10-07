import { resolveProjectName, resolveCostFigures } from '../navigator-banner-helpers.js';

const countHazards = (violations = []) => {
  const counts = { critical: 0, highMedium: 0, low: 0 };
  for (const v of violations) {
    const isCritical = v.severity === 'CRITICAL';
    const isHighOrMedium = v.severity === 'HIGH' || v.severity === 'MEDIUM';
    if (isCritical) counts.critical += 1;
    else if (isHighOrMedium) counts.highMedium += 1;
    else counts.low += 1;
  }
  return counts;
};

export const buildAuditSummary = (report, { projectRoot, scope }) => {
  const gate = report.gate ?? {};
  const summary = {
    project: resolveProjectName(projectRoot),
    scope,
    files: report.metrics?.scannedFiles ?? 0,
    loc: report.metrics?.totalLoc ?? 0,
    tokens: { estimate: report.contextAnalysis?.estimatedTokens ?? 0, savingsPct: report.contextAnalysis?.potentialSavingsPct ?? 0 },
    health: { score: report.health.score, grade: report.health.grade, label: report.health.label ?? null },
    aiSlop: { score: report.aiSlop?.score ?? 100, grade: report.aiSlop?.grade ?? 'A+' },
    hazards: countHazards(report.violations),
    cost: resolveCostFigures(report.contextAnalysis),
    gate: { passing: gate.isPassing ?? null, basis: gate.basis ?? null, regressions: (gate.regressions ?? []).slice(0, 5), note: gate.note ?? null }
  };
  return report.rebaseline ? { ...summary, rebaseline: report.rebaseline } : summary;
};
