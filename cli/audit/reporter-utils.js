export const CYAN = '\x1b[38;2;98;201;255m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const ORANGE = '\x1b[38;5;208m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
export const RESET = '\x1b[0m';

export const groupViolationsBySeverity = (violations) => {
  const critical = [];
  const high = [];
  const medium = [];
  const low = [];

  for (const v of violations) {
    if (v.severity === 'CRITICAL') critical.push(v);
    else if (v.severity === 'HIGH') high.push(v);
    else if (v.severity === 'MEDIUM') medium.push(v);
    else low.push(v);
  }

  return { critical, high, medium, low };
};

export const getSeverityBadge = (severity) => {
  switch (severity) {
    case 'CRITICAL':
      return `${RED}[CRITICAL]${RESET}`;
    case 'HIGH':
      return `${ORANGE}[HIGH]${RESET}`;
    case 'MEDIUM':
      return `${ORANGE}[MEDIUM]${RESET}`;
    case 'LOW':
      return `${YELLOW}[LOW]${RESET}`;
    default:
      return `[${severity}]`;
  }
};

export const getStatusBadge = (status) => {
  switch (status) {
    case 'PASSED':
      return `${GREEN}✔ PASS${RESET}`;
    case 'WARN':
      return `${YELLOW}⚠ WARN${RESET}`;
    case 'FAILED':
      return `${RED}✕ FAIL${RESET}`;
    default:
      return status;
  }
};

export const resolveGradeColor = (scoreOrGrade) => {
  if (typeof scoreOrGrade === 'string') {
    const g = scoreOrGrade.toUpperCase();
    if (g.startsWith('A')) return GREEN;
    if (g === 'B' || g === 'C') return YELLOW;
    if (g === 'D') return ORANGE;
    return RED;
  }
  if (scoreOrGrade >= 90) return GREEN;
  if (scoreOrGrade >= 70) return YELLOW;
  return RED;
};

export const resolveRiskColor = (riskLevel) => {
  if (riskLevel === 'HIGH') return RED;
  if (riskLevel === 'MODERATE') return YELLOW;
  return GREEN;
};

export const resolveTopSectionColor = (report) => {
  const hasNoViolations = (report?.violations?.length ?? 0) === 0;
  const hasNoHotspots = (report?.hotspots?.length ?? 0) === 0;
  const areAllPillarsPassed = Object.values(report?.pillars ?? {}).every((p) => p.status === 'PASSED');
  const isAllPassed = hasNoViolations && hasNoHotspots && areAllPillarsPassed;
  return isAllPassed ? GREEN : CYAN;
};

export const resolveHotspotBadge = (lineCount) => {
  if (lineCount >= 2000) return ` ${RED}[CRITICAL MONOLITH >= 2,000 lines of code]${RESET}`;
  if (lineCount >= 1000) return ` ${ORANGE}[SEVERE MONOLITH >= 1,000 lines of code]${RESET}`;
  if (lineCount > 500) return ` ${YELLOW}[MONOLITH WARNING > 500 lines of code]${RESET}`;
  return '';
};

export const resolveHealthHearts = (grade, score = 0, isAnsi = true) => {
  const g = String(grade || '').toUpperCase();
  let filled = 1;
  if (g.startsWith('A') || score >= 90) filled = 5;
  else if (g.startsWith('B') || score >= 80) filled = 4;
  else if (g.startsWith('C') || score >= 70) filled = 3;
  else if (g.startsWith('D') || score >= 60) filled = 2;
  else filled = score === 0 ? 0 : 1;

  const empty = 5 - filled;
  if (!isAnsi) {
    return '❤︎'.repeat(filled) + '♡'.repeat(empty);
  }
  const redHearts = `${RED}${BOLD}` + '❤︎'.repeat(filled) + RESET;
  const dimHearts = `${DIM}` + '♡'.repeat(empty) + RESET;
  return `${redHearts}${dimHearts}`;
};

export const PILLAR_EMOJIS = {
  'Line Budgets & Monolith Decomposition': '📏',
  'Control Flow & Boolean Logic': '🔀',
  'Reactivity & Composable Contracts': '⚛️',
  'Type Architecture & Data Integrity': '🛡️',
  'Design System & Styling Hygiene': '🎨',
  'Timers & Macro-Task Discipline': '⏱️',
  'Global Hygiene & Typography': '🧹'
};

export const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const resolvePriorityBadge = (idx) => {
  return NUMBER_EMOJIS[idx] || `${idx + 1}`;
};

export const resolveMarkdownStatusIcon = (status) => {
  if (status === 'PASSED') return '🟢 **PASSED**';
  if (status === 'WARN') return '🟡 **WARN**';
  return '🔴 **FAILED**';
};

export const resolveMarkdownMonolithText = (lineCount) => {
  if (lineCount >= 2000) return '🔴 **CRITICAL (>= 2,000 lines of code)**';
  if (lineCount >= 1000) return '🟠 **SEVERE (>= 1,000 lines of code)**';
  if (lineCount > 500) return '🟡 **WARNING (> 500 lines of code)**';
  return '🟢 Compliant';
};
