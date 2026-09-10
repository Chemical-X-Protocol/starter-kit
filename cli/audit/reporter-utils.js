export const CYAN = '\x1b[38;2;98;201;255m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
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
      return `${RED}[HIGH]${RESET}`;
    case 'MEDIUM':
      return `${YELLOW}[MEDIUM]${RESET}`;
    case 'LOW':
      return `${DIM}[LOW]${RESET}`;
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

export const resolveGradeColor = (score) => {
  if (score >= 90) return GREEN;
  if (score >= 70) return YELLOW;
  return RED;
};

export const resolveRiskColor = (riskLevel) => {
  if (riskLevel === 'HIGH') return RED;
  if (riskLevel === 'MODERATE') return YELLOW;
  return GREEN;
};

export const resolveHotspotBadge = (lineCount) => {
  if (lineCount >= 2000) return ` ${RED}[CRITICAL MONOLITH >= 2,000 LOC]${RESET}`;
  if (lineCount >= 1000) return ` ${RED}[SEVERE MONOLITH >= 1,000 LOC]${RESET}`;
  if (lineCount > 500) return ` ${YELLOW}[MONOLITH WARNING > 500 LOC]${RESET}`;
  return '';
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
  if (lineCount >= 2000) return '🔴 **CRITICAL (>= 2,000 LOC)**';
  if (lineCount >= 1000) return '🟠 **SEVERE (>= 1,000 LOC)**';
  if (lineCount > 500) return '🟡 **WARNING (> 500 LOC)**';
  return '🟢 Compliant';
};
