import { PILLARS } from './rules.js';
import {
  buildMasterPrompt,
  formatPromptBox
} from './prompts.js';
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
  resolveHotspotBadge
} from './reporter-utils.js';

export {
  groupViolationsBySeverity,
  getSeverityBadge,
  getStatusBadge,
  resolveGradeColor,
  resolveHealthHearts,
  resolveRiskColor,
  resolveHotspotBadge,
  resolveMarkdownStatusIcon,
  resolveMarkdownMonolithText,
  PILLAR_EMOJIS,
  NUMBER_EMOJIS,
  resolvePriorityBadge,
  CYAN,
  GREEN,
  YELLOW,
  RED,
  ORANGE,
  DIM,
  BOLD,
  RESET
} from './reporter-utils.js';

export { generateMarkdownReport } from './reporter-markdown.js';

export {
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection
} from './reporter-grades.js';

export {
  getAsciiGradeLines,
  formatAsciiGrade,
  getReportCardAsciiLines,
  REPORT_CARD_ASCII
} from './reporter-ascii.js';

import { getAsciiGradeLines, getReportCardAsciiLines } from './reporter-ascii.js';

export const resolveTopSectionColor = (report) => {
  const hasNoViolations = (report?.violations?.length ?? 0) === 0;
  const hasNoHotspots = (report?.hotspots?.length ?? 0) === 0;
  const areAllPillarsPassed = Object.values(report?.pillars ?? {}).every((p) => p.status === 'PASSED');
  const isAllPassed = hasNoViolations && hasNoHotspots && areAllPillarsPassed;
  return isAllPassed ? GREEN : CYAN;
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
    critical.forEach((v, idx) => {
      lines.push(`   ${RED}[#${idx + 1} CRITICAL]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
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
      lines.push(`\n   ${BOLD}--- High Severity (${high.length} items) ---${RESET}`);
      high.forEach((v, idx) => {
        lines.push(`   ${ORANGE}[#${idx + 1} HIGH]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }

    if (medium.length > 0) {
      lines.push(`\n   ${BOLD}--- Medium Severity (${medium.length} items) ---${RESET}`);
      medium.forEach((v, idx) => {
        lines.push(`   ${ORANGE}[#${idx + 1} MED]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
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
    low.forEach((v, idx) => {
      lines.push(`   ${YELLOW}[#${idx + 1} LOW]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
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
  lines.push(`   ${DIM}Pillar Name                                   Status     Violations${RESET}`);
  lines.push(`   ${DIM}------------------------------------------------------------------${RESET}`);
  for (const [pillarName, data] of Object.entries(pillars)) {
    const padName = pillarName.padEnd(45, ' ');
    const badge = getStatusBadge(data.status).padEnd(16, ' ');
    const countStr = data.violations === 0 ? `${GREEN}0${RESET}` : `${RED}${data.violations}${RESET}`;
    lines.push(`   ${padName} ${badge} ${countStr}`);
  }
  lines.push(`${sectionColor}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatHotspotsSection = (report, themeColor = null) => {
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
    hotspots.forEach((h, idx) => {
      const monolithBadge = resolveHotspotBadge(h.lineCount);
      lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards)${monolithBadge}`);
    });
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

export const getChemicalXAsciiBanner = (gradeOrReport = null) => {
  const grade = typeof gradeOrReport === 'object' && gradeOrReport !== null
    ? gradeOrReport.health?.grade
    : gradeOrReport;

  const art = [
    ' ██████╗██╗  ██╗███████╗███╗   ███╗██╗ ██████╗ █████╗ ██╗         ██╗  ██╗',
    '██╔════╝██║  ██║██╔════╝████╗ ████║██║██╔════╝██╔══██╗██║         ╚██╗██╔╝',
    '██║     ███████║█████╗  ██╔████╔██║██║██║     ███████║██║          ╚███╔╝ ',
    '██║     ██╔══██║██╔══╝  ██║╚██╔╝██║██║██║     ██╔══██║██║          ██╔██╗ ',
    '╚██████╗██║  ██║███████╗██║ ╚═╝ ██║██║╚██████╗██║  ██║███████╗    ██╔╝ ██╗',
    ' ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝    ╚═╝  ╚═╝'
  ];

  const maxLen = 74;
  const lines = [];

  lines.push('                     \x1b[1m\x1b[37mThe Secret Sauce to \x1b[38;2;98;201;255mVibe Coding\x1b[0m');

  const gColor = grade ? resolveGradeColor(grade) : '';
  const gradeLines = grade ? getAsciiGradeLines(grade, gColor, true) : [];
  const termWidth = process.stdout.columns || 0;
  const isSideBySide = Boolean(!termWidth || termWidth >= 105);

  for (let lineIdx = 0; lineIdx < art.length; lineIdx++) {
    const line = art[lineIdx];
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') {
        out += ' ';
        continue;
      }
      const t = i / (maxLen - 1);
      let r, g, b;
      if (t < 0.5) {
        const factor = t * 2;
        r = Math.round(244 * (1 - factor) + 192 * factor);
        g = Math.round(114 * (1 - factor) + 132 * factor);
        b = Math.round(182 * (1 - factor) + 252 * factor);
      } else {
        const factor = (t - 0.5) * 2;
        r = Math.round(192 * (1 - factor) + 129 * factor);
        g = Math.round(132 * (1 - factor) + 140 * factor);
        b = Math.round(252 * (1 - factor) + 248 * factor);
      }
      out += `\x1b[38;2;${r};${g};${b}m\x1b[1m${ch}\x1b[0m`;
    }

    if (isSideBySide && gradeLines.length > lineIdx) {
      out += `   ${gradeLines[lineIdx]}`;
    }

    lines.push(out);
  }

  const subtitle = 'Architectural guardrails to eliminate token burn and AI hallucinations.';
  const pad = ' '.repeat(Math.max(0, Math.floor((maxLen - subtitle.length) / 2)));
  lines.push(`${pad}\x1b[2m${subtitle}\x1b[0m\n`);

  if (!isSideBySide && gradeLines.length > 0) {
    for (const gl of gradeLines) {
      lines.push(`   ${gl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

export const formatTerminalReport = (report) => {
  const lines = [];
  const topColor = resolveTopSectionColor(report);

  lines.push('');
  lines.push(getChemicalXAsciiBanner(report?.health?.grade));
  lines.push(`${topColor}======================================================================${RESET}`);
  lines.push(`${BOLD}${topColor}   CHEMICAL X PROTOCOL : FULL CODEBASE ARCHITECTURAL AUDIT REPORT${RESET}`);
  lines.push(`${DIM}   Molecular Architecture Standards & Context Hazard Verification${RESET}`);
  lines.push(`${topColor}======================================================================${RESET}`);

  lines.push(formatScorecardSection(report, topColor));
  lines.push(formatContextAnalysisSection(report, topColor));
  lines.push(formatPillarsSection(report, topColor));
  lines.push(formatHotspotsSection(report, topColor));
  lines.push(formatCriticalSection(report));
  lines.push(formatHighMediumSection(report));
  lines.push(formatLowSection(report));

  const masterPrompt = buildMasterPrompt(report);
  if (masterPrompt) {
    lines.push(formatPromptBox('🤖 MASTER AI AGENT REFACTORING PROMPT', masterPrompt));
  }

  return lines.join('\n');
};

export const formatFailuresSection = (report) => {
  const { violations, pillars, hotspots } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('');
  lines.push(`${RED}======================================================================${RESET}`);
  lines.push(`${BOLD}${RED}   FAILED & DEGRADED CHECKS : HAZARDS, DEBTS & HOTSPOTS${RESET}`);
  lines.push(`${DIM}   Consolidated breakdown of all failed architectural checks${RESET}`);
  lines.push(`${RED}======================================================================${RESET}`);

  if (violations.length === 0 && hotspots.length === 0) {
    lines.push(`\n   ${GREEN}${BOLD}✔ ZERO FAILURES DETECTED!${RESET}`);
    lines.push('   All 7 Chemical X Molecular Architecture Pillars are 100% Compliant.\n');
    lines.push(`${RED}======================================================================${RESET}\n`);
    return lines.join('\n');
  }

  lines.push(`   Total Hazards Flagged:   ${BOLD}${RED}${violations.length}${RESET}`);
  const critDesc = critical.length > 0 ? `${RED}${BOLD}${critical.length} (Immediate Action Required)${RESET}` : `${GREEN}0${RESET}`;
  lines.push(`   Critical Hazards:        ${critDesc}`);
  const debtsTotal = high.length + medium.length;
  const debtsDesc = debtsTotal > 0 ? `${ORANGE}${BOLD}${debtsTotal}${RESET}` : `${GREEN}0${RESET}`;
  lines.push(`   High/Med Debts:          ${debtsDesc}`);
  const lowDesc = low.length > 0 ? `${YELLOW}${low.length}${RESET}` : `${GREEN}0${RESET}`;
  lines.push(`   Low Hygiene Issues:      ${lowDesc}`);
  const hotspotsDesc = hotspots.length > 0 ? `${YELLOW}${hotspots.length}${RESET}` : `${GREEN}0${RESET}`;
  lines.push(`   Hotspot Files:           ${hotspotsDesc}`);
  lines.push(`${RED}----------------------------------------------------------------------${RESET}`);

  if (critical.length > 0) {
    lines.push(`\n   ${BOLD}${RED}🚨 CRITICAL HAZARDS (${critical.length}) : IMMEDIATE ACTION REQUIRED${RESET}`);
    critical.forEach((v, idx) => {
      lines.push(`   ${RED}[#${idx + 1} CRITICAL]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }

  if (debtsTotal > 0) {
    lines.push(`   ${BOLD}${ORANGE}⚠️  HIGH & MEDIUM HAZARDS (${debtsTotal}) : ARCHITECTURE DEBTS${RESET}`);
    [...high, ...medium].forEach((v, idx) => {
      const isHigh = v.severity === 'HIGH';
      const badge = isHigh ? `${ORANGE}[#${idx + 1} HIGH]${RESET}` : `${ORANGE}[#${idx + 1} MED]${RESET}`;
      lines.push(`   ${badge} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }

  if (low.length > 0) {
    lines.push(`   ${BOLD}${YELLOW}🧹 LOW & HYGIENE ISSUES (${low.length})${RESET}`);
    low.forEach((v, idx) => {
      lines.push(`   ${YELLOW}[#${idx + 1} LOW]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }

  const failedPillars = Object.entries(pillars).filter(([_, p]) => p.status !== 'PASSED');
  if (failedPillars.length > 0) {
    lines.push(`   ${BOLD}${RED}🏛️  FAILED / DEGRADED PILLARS (${failedPillars.length})${RESET}`);
    for (const [name, p] of failedPillars) {
      lines.push(`   ✕ ${YELLOW}${name}${RESET}: ${p.violations} violations (${p.critical} Critical, ${p.high} High, ${p.medium} Med)`);
    }
    lines.push('');
  }

  if (hotspots.length > 0) {
    lines.push(`   ${BOLD}${YELLOW}🔥 REFACTORING HOTSPOTS (${hotspots.length})${RESET}`);
    hotspots.forEach((h, idx) => {
      const monolithBadge = resolveHotspotBadge(h.lineCount);
      lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards)${monolithBadge}`);
    });
    lines.push('');
  }

  const prompt = buildMasterPrompt(report);
  if (prompt) {
    lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (ALL FAILED CHECKS)', prompt));
  }

  lines.push(`${RED}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatPassesSection = (report) => {
  const { metrics, health, pillars, hotspots, contextAnalysis } = report;
  const passedPillars = Object.entries(pillars).filter(([_, p]) => p.status === 'PASSED');
  const lines = [];

  lines.push('');
  lines.push(`${GREEN}======================================================================${RESET}`);
  lines.push(`${BOLD}${GREEN}   PASSED & COMPLIANT CHECKS : CLEAN ARCHITECTURE STANDARDS${RESET}`);
  lines.push(`${DIM}   Consolidated breakdown of verified compliant areas${RESET}`);
  lines.push(`${GREEN}======================================================================${RESET}`);

  lines.push(`   Molecular Health Score:    ${BOLD}${GREEN}${health.score}/100${RESET} [Grade: ${BOLD}${GREEN}${health.grade}${RESET}]`);
  lines.push(`   Passing Pillars:         ${BOLD}${GREEN}${passedPillars.length} / 7 Pillars PASSED${RESET}`);
  lines.push(`   Capsule Compliance:      ${BOLD}${GREEN}${metrics.moleculeCompliantPct}%${RESET} molecules compliant (< 100 lines of code)`);
  lines.push(`   Total Files Scanned:     ${metrics.scannedFiles} source files (${metrics.totalLoc} total lines of code)`);
  lines.push(`${GREEN}----------------------------------------------------------------------${RESET}`);

  lines.push(`\n   ${BOLD}${GREEN}✔ COMPLIANT ARCHITECTURAL PILLARS:${RESET}`);
  if (passedPillars.length === 0) {
    lines.push(`   ${YELLOW}No pillars are completely hazard-free.${RESET}\n`);
  } else {
    for (const [name] of passedPillars) {
      lines.push(`   ${GREEN}✔${RESET} ${name} ${DIM}(0 violations)${RESET}`);
    }
    lines.push('');
  }

  lines.push(`   ${BOLD}${CYAN}STANDARDS MET & CLEAN AREAS:${RESET}`);
  if (metrics.moleculeCompliantPct === 100) {
    lines.push(`   ${GREEN}✔${RESET} 100% Molecule Capsule Limit (< 100 lines per molecule)`);
  }
  const hasExtremeMonolith = hotspots.some((h) => h.lineCount >= 2000);
  if (!hasExtremeMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Extreme Monoliths (0 files >= 2,000 lines of code)`);
  }
  const hasSevereMonolith = hotspots.some((h) => h.lineCount >= 1000);
  if (!hasSevereMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Severe Monoliths (0 files >= 1,000 lines of code)`);
  }
  if (contextAnalysis.riskLevel === 'LOW') {
    lines.push(`   ${GREEN}✔${RESET} Low Context Hazard & Token Burn Risk`);
  }

  lines.push(`\n${GREEN}======================================================================${RESET}\n`);
  return lines.join('\n');
};
