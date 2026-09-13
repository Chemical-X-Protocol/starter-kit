import {
  CYAN,
  GREEN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET,
  groupViolationsBySeverity,
  getStatusBadge,
  resolveGradeColor,
  resolveHealthHearts,
  resolveRiskColor,
  resolveHotspotBadge,
  resolveTopSectionColor,
  resolveIndividualPillarGrade,
  PILLAR_EMOJIS,
  formatPillarReactionBadgesTerminal
} from './reporter-utils.js';
import { getAsciiGradeLines, getReportCardAsciiLines } from './reporter-ascii.js';
import { renderGroupedViolationsTerminal } from './reporter-grouping.js';
import {
  buildAiSlopPrompt,
  buildHotspotsPrompt,
  formatPromptBox
} from './prompts.js';

const isSlopViolation = (v) => Boolean(v.isAiSlop);

const formatHotspotItem = (h, idx) => {
  const monolithBadge = resolveHotspotBadge(h.lineCount);
  return `   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards)${monolithBadge}`;
};

export const formatScorecardSection = (report, themeColor = null) => {
  const { metrics, health } = report;
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const gradeColor = resolveGradeColor(health?.score ?? health?.grade ?? 'A');
  const lines = [];

  lines.push('');
  for (const rcLine of getReportCardAsciiLines(sectionColor)) {
    lines.push(`   ${rcLine}`);
  }
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   MOLECULAR HEALTH INDEX & CODEBASE OVERVIEW${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);

  const asciiGradeLines = getAsciiGradeLines(health?.grade || 'A', gradeColor);
  if (asciiGradeLines.length > 0) {
    lines.push('');
    for (const asciiLine of asciiGradeLines) {
      lines.push(`   ${asciiLine}`);
    }
    lines.push('');
    lines.push(`${sectionColor}----------------------------------------------------------------------${RESET}`);
  }

  const hearts = resolveHealthHearts(health?.grade, health?.score);
  lines.push(`   Life / Health Meter: ${hearts} ${gradeColor}${BOLD}${health.score} / 100${RESET} (Grade: ${gradeColor}${BOLD}${health.grade}${RESET} - ${health.label})`);

  if (report.aiSlop) {
    const slopGradeColor = resolveGradeColor(report.aiSlop.grade);
    const slopHearts = resolveHealthHearts(report.aiSlop.grade, report.aiSlop.score);
    lines.push(`   AI Slop Index (ASI): ${slopHearts} ${slopGradeColor}${BOLD}${report.aiSlop.score} / 100${RESET} (Grade: ${slopGradeColor}${BOLD}${report.aiSlop.grade}${RESET} - ${report.aiSlop.label})`);
  }
  lines.push(`   Files Scanned:       ${BOLD}${metrics.scannedFiles}${RESET} source files`);
  lines.push(`   Total Lines of Code: ${BOLD}${metrics.totalLoc}${RESET} lines of code (avg: ${metrics.avgLoc} lines/file)`);
  lines.push(`   Largest File:        ${BOLD}${metrics.largestFile.filePath || 'None'}${RESET} (${metrics.largestFile.lineCount} lines)`);
  lines.push(`   Molecule Capsules:   ${metrics.moleculeCount} found (${metrics.moleculeCompliantPct}% compliant < 100 lines of code)`);
  lines.push(`   Custom Hooks:        ${metrics.hookCount} detected`);
  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatCriticalSection = (report) => {
  const { violations } = report;
  const { critical } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('');
  lines.push(`${RED}======================================================================${RESET}`);
  lines.push(`${BOLD}${RED}   CRITICAL HAZARDS (${critical.length} TOTAL) : IMMEDIATE ACTION REQUIRED${RESET}`);
  lines.push(`${DIM}   Violations that break Molecular line budgets or introduce severe AST bugs${RESET}`);
  lines.push(`${RED}======================================================================${RESET}`);

  if (critical.length === 0) {
    lines.push(`   ${GREEN}✔ Zero critical hazards detected. No monoliths or breaking AST patterns.${RESET}`);
  } else {
    lines.push(renderGroupedViolationsTerminal(critical));
  }
  lines.push(`${RED}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatHighMediumSection = (report) => {
  const { violations } = report;
  const { high, medium } = groupViolationsBySeverity(violations);
  const totalCount = high.length + medium.length;
  const lines = [];

  lines.push('');
  lines.push(`${ORANGE}======================================================================${RESET}`);
  lines.push(`${BOLD}${ORANGE}   HIGH & MEDIUM HAZARDS (${totalCount} TOTAL) : ARCHITECTURE DEBTS${RESET}`);
  lines.push(`${DIM}   Saturation, complex control flow booleans, and raw inline styles${RESET}`);
  lines.push(`${ORANGE}======================================================================${RESET}`);

  if (totalCount === 0) {
    lines.push(`   ${GREEN}✔ Zero high or medium architecture hazards detected.${RESET}`);
  } else {
    if (high.length > 0) {
      lines.push(`\n   ${BOLD}--- High Severity (${high.length} items) ---${RESET}\n`);
      lines.push(renderGroupedViolationsTerminal(high));
    }

    if (medium.length > 0) {
      lines.push(`\n   ${BOLD}--- Medium Severity (${medium.length} items) ---${RESET}\n`);
      lines.push(renderGroupedViolationsTerminal(medium));
    }
  }
  lines.push(`${ORANGE}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatLowSection = (report) => {
  const { violations } = report;
  const { low } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('');
  lines.push(`${YELLOW}======================================================================${RESET}`);
  lines.push(`${BOLD}${YELLOW}   LOW & HYGIENE ISSUES (${low.length} TOTAL) : TYPOGRAPHY & LOGGING${RESET}`);
  lines.push(`${DIM}   Em dash typography violations and unguarded console statements${RESET}`);
  lines.push(`${YELLOW}======================================================================${RESET}`);

  if (low.length === 0) {
    lines.push(`   ${GREEN}✔ Zero typography or logging hygiene issues detected.${RESET}`);
  } else {
    lines.push(renderGroupedViolationsTerminal(low));
  }
  lines.push(`${YELLOW}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatPillarsSection = (report, themeColor = null) => {
  const { pillars } = report;
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   7-PILLAR ARCHITECTURAL COMPLIANCE MATRIX${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);

  const reactionStrip = formatPillarReactionBadgesTerminal(pillars);
  if (reactionStrip) {
    lines.push(`   ${BOLD}Reaction Badges:${RESET} ${reactionStrip}`);
    lines.push(`${sectionColor}----------------------------------------------------------------------${RESET}`);
  }

  lines.push(`   ${DIM}Pillar Name                                         Status     Violations${RESET}`);
  lines.push(`   ${DIM}------------------------------------------------------------------------${RESET}`);
  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const padName = `[ ${icon} ] ${pillarName}`.padEnd(51, ' ');
    const badge = getStatusBadge(data.status).padEnd(16, ' ');
    const countStr = data.violations === 0 ? `${GREEN}0${RESET}` : `${RED}${data.violations}${RESET}`;
    lines.push(`   ${padName} ${badge} ${countStr}`);
  }
  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatSinglePillarSection = (report, pillarName, themeColor = null) => {
  const pillarData = report?.pillars?.[pillarName] || {
    violations: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    status: 'PASSED'
  };
  const grade = resolveIndividualPillarGrade(pillarData);
  const gradeColor = resolveGradeColor(grade);
  const sectionColor = themeColor || gradeColor;
  const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   [ ${icon} ] PILLAR ARCHITECTURAL AUDIT : ${pillarName.toUpperCase()}${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`   Pillar Grade:      ${gradeColor}${BOLD}Grade: ${grade}${RESET}`);
  lines.push(`   Compliance Status: ${getStatusBadge(pillarData.status)}`);
  lines.push(`   Violations:        ${pillarData.violations} total (${pillarData.critical} Critical, ${pillarData.high} High, ${pillarData.medium} Medium, ${pillarData.low} Low)`);
  lines.push(`${sectionColor}----------------------------------------------------------------------${RESET}`);

  if (pillarData.violations === 0) {
    lines.push(`\n   ${GREEN}✔ Outstanding! Zero violations detected for this pillar.${RESET}`);
    lines.push(`   ${DIM}All inspected modules adhere strictly to Chemical X standards for ${pillarName}.${RESET}\n`);
  } else {
    const pillarViolations = (report.violations || []).filter((v) => v.pillar === pillarName);
    if (pillarViolations.length > 0) {
      lines.push(`\n   ${BOLD}${sectionColor}🚨 DETECTED VIOLATIONS (${pillarViolations.length}):${RESET}\n`);
      lines.push(renderGroupedViolationsTerminal(pillarViolations));
    }
  }

  const isPillar1 = pillarName === 'Line Budgets & Monolith Decomposition';
  if (isPillar1) {
    const monolithHotspots = (report?.hotspots || []).filter((h) => h.isMonolith || h.lineCount > 500);
    if (monolithHotspots.length > 0) {
      lines.push(`   ${BOLD}${sectionColor}🔥 MONOLITHIC HOTSPOTS (${monolithHotspots.length}):${RESET}`);
      monolithHotspots.forEach((h, idx) => {
        lines.push(formatHotspotItem(h, idx));
      });
      lines.push('');
    }
  }

  lines.push(`${sectionColor}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatHotspotsSection = (report, themeColor = null, options = {}) => {
  const { includePrompt = true } = typeof options === 'boolean' ? { includePrompt: options } : options;
  const { hotspots } = report;
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   TOP REFACTORING HOTSPOTS (PRIORITY RANKING)${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);

  if (hotspots.length === 0) {
    lines.push(`   ${GREEN}✔ Zero hotspot files. All files stay within architectural budgets.${RESET}`);
  } else {
    for (let idx = 0; idx < hotspots.length; idx++) {
      lines.push(formatHotspotItem(hotspots[idx], idx));
    }
  }

  if (includePrompt) {
    const promptHotspots = buildHotspotsPrompt(report);
    if (promptHotspots) {
      lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (MONOLITH DECOMPOSITION)', promptHotspots));
    }
  }

  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatContextAnalysisSection = (report, themeColor = null) => {
  const { contextAnalysis } = report;
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const riskColor = resolveRiskColor(contextAnalysis.riskLevel);
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   CONTEXT ROT & TOKEN BURN ANALYTICS${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`   Estimated Codebase Tokens:  ~${contextAnalysis.estimatedTokens.toLocaleString()} tokens`);
  lines.push(`   Estimated Monolith Bloat:   ~${contextAnalysis.estimatedExcessTokens.toLocaleString()} tokens`);
  lines.push(`   Target Architecture Cut:    ${BOLD}${contextAnalysis.potentialSavingsPct}%${RESET} token reduction potential`);
  lines.push(`   Agent Hallucination Risk:   ${riskColor}${BOLD}${contextAnalysis.riskLevel}${RESET}`);
  if (contextAnalysis.excessCostPerPass !== undefined) {
    const costPass = contextAnalysis.excessCostPerPass.toFixed(3);
    const costMonth = contextAnalysis.monthlyWastePerDev.toFixed(2);
    const costWeek = contextAnalysis.weeklyWastePerDev.toFixed(2);
    lines.push(`   Pricing Model Baseline:     ${contextAnalysis.pricingModel}`);
    lines.push(`   Monolith Bloat per AI Turn: \x1b[38;5;208;1m$${costPass}\x1b[0m / prompt turn`);
    lines.push(`   Projected Dev Context Tax:  \x1b[31;1m$${costMonth}/mo\x1b[0m per engineer ($${costWeek}/wk)`);
  }
  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatAiSlopSection = (report, themeColor = null, options = {}) => {
  const { includePrompt = true } = typeof options === 'boolean' ? { includePrompt: options } : options;
  const { aiSlop, violations = [] } = report;
  const slopViolations = violations.filter(isSlopViolation);
  const sectionColor = themeColor || resolveTopSectionColor(report);
  const slopColor = resolveGradeColor(aiSlop?.grade || 'A+');
  const lines = [];

  lines.push('');
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${sectionColor}   AI SLOP INDEX & CODE AUTHENTICITY AUDIT${RESET}`);
  lines.push(`${DIM}   Deterministic detection of LLM conversational residue and echo comments${RESET}`);
  lines.push(`${sectionColor}======================================================================${RESET}`);
  lines.push(`   AI Slop Score:        ${slopColor}${BOLD}${aiSlop?.score ?? 100} / 100${RESET} (Grade: ${slopColor}${BOLD}${aiSlop?.grade ?? 'A+'}${RESET} - ${aiSlop?.label ?? 'Pure Artisanal'})`);
  lines.push(`   Slop Hazards Flagged: ${slopViolations.length > 0 ? `${RED}${BOLD}${slopViolations.length}${RESET}` : `${GREEN}0 (Artisanal Clean)${RESET}`}`);
  lines.push(`${sectionColor}----------------------------------------------------------------------${RESET}`);

  if (slopViolations.length === 0) {
    lines.push(`   ${GREEN}✔ Zero AI slop detected. Codebase is free of conversational residue and echo comments.${RESET}`);
  } else {
    lines.push(renderGroupedViolationsTerminal(slopViolations));
  }

  if (includePrompt) {
    const promptSlop = buildAiSlopPrompt(report);
    if (promptSlop) {
      lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (AI SLOP & AUTHENTICITY)', promptSlop));
    }
  }

  lines.push(`${sectionColor}======================================================================${RESET}\n`);
  return lines.join('\n');
};
