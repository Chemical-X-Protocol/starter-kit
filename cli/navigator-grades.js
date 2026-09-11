export const resolveGradeColor = (grade) => {
  if (grade === 'A+' || grade === 'A') return '\x1b[32;1m';
  if (grade === 'B') return '\x1b[36;1m';
  if (grade === 'C') return '\x1b[33;1m';
  if (grade === 'D') return '\x1b[38;5;208;1m';
  return '\x1b[31;1m';
};

export const resolveGradeBadge = (grade) => {
  const color = resolveGradeColor(grade);
  const padded = grade.length === 1 ? `${grade} ` : grade;
  return `${color}[Grade: ${padded}]\x1b[0m`;
};

export const resolveCriticalGrade = (count) => {
  if (count === 0) return 'A+';
  if (count === 1) return 'D';
  return 'F';
};

export const resolveHighMedGrade = (count) => {
  if (count === 0) return 'A+';
  if (count <= 3) return 'B';
  if (count <= 8) return 'C';
  if (count <= 15) return 'D';
  return 'F';
};

export const resolveLowGrade = (count) => {
  if (count === 0) return 'A+';
  if (count <= 5) return 'B';
  if (count <= 15) return 'C';
  return 'D';
};

const isFailedPillar = (p) => p.status === 'FAILED';
const isWarnPillar = (p) => p.status === 'WARN';

export const resolvePillarGrade = (pillars) => {
  const values = Object.values(pillars || {});
  const failed = values.filter(isFailedPillar).length;
  const warn = values.filter(isWarnPillar).length;
  if (failed === 0 && warn === 0) return 'A+';
  if (failed === 0) return 'B';
  if (failed <= 2) return 'C';
  if (failed <= 4) return 'D';
  return 'F';
};

const isExtremeFile = (h) => h.lineCount >= 2000;
const isSevereFile = (h) => h.lineCount >= 1000;
const isWarningFile = (h) => h.lineCount > 500;

export const resolveHotspotGrade = (hotspots) => {
  if (!hotspots || hotspots.length === 0) return 'A+';
  const hasExtreme = hotspots.some(isExtremeFile);
  if (hasExtreme) return 'F';
  const hasSevere = hotspots.some(isSevereFile);
  if (hasSevere) return 'D';
  const hasWarning = hotspots.some(isWarningFile);
  if (hasWarning) return 'C';
  return 'B';
};

export const resolveContextGrade = (riskTier) => {
  if (riskTier === 'LOW') return 'A';
  if (riskTier === 'MEDIUM') return 'B';
  if (riskTier === 'HIGH') return 'D';
  return 'F';
};
