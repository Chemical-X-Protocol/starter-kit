export {
  CHEMX_COLORS,
  CHEMX_RGB,
  getChemicalXGradientColor,
  formatChemicalXGradient
} from '../theme.js';

export const CYAN = '\x1b[38;2;56;189;248m';
export const PINK = '\x1b[38;2;244;63;133m';
export const PURPLE = '\x1b[38;2;168;85;247m';
export const MINT = '\x1b[38;2;45;212;191m';
export const LIME = '\x1b[38;2;163;230;53m';
export const GOLD = '\x1b[38;2;251;191;36m';
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
  'Global Hygiene & Typography': '🧹',
  'Accessibility & Semantic Integrity': '♿',
  'Security & Content Safety': '🔒',
  'Testing Discipline': '🧪',
  'Naming Conventions': '🏷️'
};

export const PILLAR_SHORT_NAMES = {
  'Line Budgets & Monolith Decomposition': 'Monoliths',
  'Control Flow & Boolean Logic': 'Logic',
  'Reactivity & Composable Contracts': 'Reactivity',
  'Type Architecture & Data Integrity': 'Types',
  'Design System & Styling Hygiene': 'Styling',
  'Timers & Macro-Task Discipline': 'Timers',
  'Global Hygiene & Typography': 'Hygiene',
  'Accessibility & Semantic Integrity': 'A11y',
  'Security & Content Safety': 'Security',
  'Testing Discipline': 'Testing',
  'Naming Conventions': 'Naming'
};

export const resolveBadgeColor = (score) => {
  if (score >= 90) return '06b6d4';
  if (score >= 70) return 'f59e0b';
  return 'ef4444';
};

export const formatPillarShieldBadges = (pillars = {}) => {
  const badges = [];
  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const shortName = PILLAR_SHORT_NAMES[pillarName] || pillarName.split(' ')[0];
    const rawLabel = `${icon} ${shortName}`.replace(/-/g, '--').replace(/ /g, '_');
    const label = encodeURIComponent(rawLabel);
    let statusText = 'PASS';
    let color = '06b6d4';
    if (data?.status === 'WARN') {
      const v = data?.violations || 0;
      statusText = encodeURIComponent(`WARN ${v}`.replace(/-/g, '--').replace(/ /g, '_'));
      color = 'f59e0b';
    } else if (data?.status === 'FAILED') {
      const v = data?.violations || 0;
      statusText = encodeURIComponent(`FAIL ${v}`.replace(/-/g, '--').replace(/ /g, '_'));
      color = 'ef4444';
    }
    badges.push(`[![${shortName}](https://img.shields.io/badge/${label}-${statusText}-${color}?style=for-the-badge)](https://chemicalx.xophz.com)`);
  }
  return badges.join(' ');
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

export const formatPillarReactionBadgesTerminal = (pillars = {}) => {
  const badges = [];
  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const violations = data?.violations || 0;
    if (data?.status === 'PASSED') {
      badges.push(`${GREEN}[ ${icon} PASS ]${RESET}`);
    } else if (data?.status === 'WARN') {
      badges.push(`${YELLOW}[ ${icon} WARN (${violations}) ]${RESET}`);
    } else {
      badges.push(`${RED}[ ${icon} FAIL (${violations}) ]${RESET}`);
    }
  }
  return badges.join(' ');
};

export const formatPillarReactionBadgesMarkdown = (pillars = {}) => {
  const badges = [];
  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const violations = data?.violations || 0;
    if (data?.status === 'PASSED') {
      badges.push(`\`[ ${icon} PASS ]\``);
    } else if (data?.status === 'WARN') {
      badges.push(`\`[ ${icon} WARN: ${violations} ]\``);
    } else {
      badges.push(`\`[ ${icon} FAIL: ${violations} ]\``);
    }
  }
  return badges.join(' ');
};
