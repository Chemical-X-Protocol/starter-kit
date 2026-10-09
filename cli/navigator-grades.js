import { hasSizeClass, isAtLeastSize } from './audit/line-budgets.js';
export const resolveGradeColor = (grade) => {
  const isAGrade = grade === 'A+' || grade === 'A';
  if (isAGrade) return '\x1b[32;1m';
  const isBGrade = grade === 'B';
  if (isBGrade) return '\x1b[33;1m';
  const isCGrade = grade === 'C';
  if (isCGrade) return '\x1b[33;1m';
  const isDGrade = grade === 'D';
  if (isDGrade) return '\x1b[38;5;208;1m';
  return '\x1b[31;1m';
};

export const resolveGradeBadge = (grade, width = 11) => {
  const color = resolveGradeColor(grade);
  const text = `Grade: ${grade}`;
  const totalPadding = Math.max(0, width - text.length);
  const leftPad = Math.floor(totalPadding / 2);
  const rightPad = totalPadding - leftPad;
  const padded = `${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}`;
  return `${color}[${padded}]\x1b[0m`;
};

const resolveFilledHearts = (g, score) => {
  const isATier = g.startsWith('A') || score >= 90;
  if (isATier) return 5;
  const isBTier = g.startsWith('B') || score >= 80;
  if (isBTier) return 4;
  const isCTier = g.startsWith('C') || score >= 70;
  if (isCTier) return 3;
  const isDTier = g.startsWith('D') || score >= 60;
  if (isDTier) return 2;
  const hasNoScore = score === 0;
  return hasNoScore ? 0 : 1;
};

export const resolveHealthHearts = (grade, score = 0) => {
  const g = String(grade || '').toUpperCase();
  const filled = resolveFilledHearts(g, score);

  const empty = 5 - filled;
  return '❤️'.repeat(filled) + '🖤'.repeat(empty);
};

export const resolveCriticalGrade = (count) => {
  const hasNoCritical = count === 0;
  if (hasNoCritical) return 'A+';
  const hasSingleCritical = count === 1;
  if (hasSingleCritical) return 'D';
  return 'F';
};

export const resolveHighMedGrade = (count) => {
  const hasNoHighMed = count === 0;
  if (hasNoHighMed) return 'A+';
  const hasFewHighMed = count <= 3;
  if (hasFewHighMed) return 'B';
  const hasSomeHighMed = count <= 8;
  if (hasSomeHighMed) return 'C';
  const hasManyHighMed = count <= 15;
  if (hasManyHighMed) return 'D';
  return 'F';
};

export const resolveLowGrade = (count) => {
  const hasNoLow = count === 0;
  if (hasNoLow) return 'A+';
  const hasFewLow = count <= 5;
  if (hasFewLow) return 'B';
  const hasSomeLow = count <= 15;
  if (hasSomeLow) return 'C';
  return 'D';
};

const isFailedPillar = (p) => p.status === 'FAILED';
const isWarnPillar = (p) => p.status === 'WARN';

export const resolveIndividualPillarGrade = (pillarData) => {
  const hasNoViolations = !pillarData || pillarData.violations === 0;
  if (hasNoViolations) return 'A+';

  const hasCritical = (pillarData.critical || 0) > 0;
  if (hasCritical) return 'F';

  const hasHigh = (pillarData.high || 0) > 0;
  if (hasHigh) return 'D';

  const hasMedium = (pillarData.medium || 0) > 0;
  if (hasMedium) return 'C';

  const hasLow = (pillarData.low || 0) > 0;
  if (hasLow) return 'B';

  return 'A+';
};

export const resolvePillarRiskWeight = (pillarData) => {
  if (!pillarData) return 0;
  const critical = pillarData.critical || 0;
  const high = pillarData.high || 0;
  const medium = pillarData.medium || 0;
  const low = pillarData.low || 0;
  return critical * 8 + high * 4 + medium * 2 + low * 1;
};

export const resolvePillarGrade = (pillars) => {
  const values = Object.values(pillars || {});
  const failed = values.filter(isFailedPillar).length;
  const warn = values.filter(isWarnPillar).length;
  const isEveryPillarPassing = failed === 0 && warn === 0;
  if (isEveryPillarPassing) return 'A+';
  const hasOnlyWarnings = failed === 0;
  if (hasOnlyWarnings) return 'B';
  const hasFewFailures = failed <= 2;
  if (hasFewFailures) return 'C';
  const hasSeveralFailures = failed <= 4;
  if (hasSeveralFailures) return 'D';
  return 'F';
};

const isExtremeFile = hasSizeClass('extreme');
const isSevereFile = (h) => isAtLeastSize(h.lineCount, 'severe');
const isWarningFile = (h) => isAtLeastSize(h.lineCount, 'warning');

export const resolveHotspotGrade = (hotspots) => {
  const hasNoHotspots = !hotspots || hotspots.length === 0;
  if (hasNoHotspots) return 'A+';
  const hasExtreme = hotspots.some(isExtremeFile);
  if (hasExtreme) return 'F';
  const hasSevere = hotspots.some(isSevereFile);
  if (hasSevere) return 'D';
  const hasWarning = hotspots.some(isWarningFile);
  if (hasWarning) return 'C';
  return 'B';
};

export const resolveContextGrade = (riskTier) => {
  const isLowRisk = riskTier === 'LOW';
  if (isLowRisk) return 'A';
  const isMediumRisk = riskTier === 'MEDIUM';
  if (isMediumRisk) return 'B';
  const isHighRisk = riskTier === 'HIGH';
  if (isHighRisk) return 'D';
  return 'F';
};

export const resolveAiSlopGrade = (score = 100) => {
  const isPristineScore = score >= 95;
  if (isPristineScore) return 'A+';
  const isExcellentScore = score >= 90;
  if (isExcellentScore) return 'A';
  const isGoodScore = score >= 80;
  if (isGoodScore) return 'B';
  const isFairScore = score >= 70;
  if (isFairScore) return 'C';
  const isPoorScore = score >= 60;
  if (isPoorScore) return 'D';
  return 'F';
};
