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
  DIM,
  BOLD,
  RESET,
  groupViolationsBySeverity,
  getStatusBadge,
  resolveGradeColor,
  resolveRiskColor,
  resolveHotspotBadge
} from './reporter-utils.js';

export {
  groupViolationsBySeverity,
  getSeverityBadge,
  getStatusBadge,
  resolveGradeColor,
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

export const formatScorecardSection = (report) => {
  const { metrics, health } = report;
  const gradeColor = resolveGradeColor(health.score);
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   MOLECULAR HEALTH INDEX & CODEBASE OVERVIEW${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`   Health Score:        ${gradeColor}${BOLD}${health.score} / 100${RESET} (Grade: ${gradeColor}${BOLD}${health.grade}${RESET} - ${health.label})`);
  lines.push(`   Files Scanned:       ${BOLD}${metrics.scannedFiles}${RESET} source files`);
  lines.push(`   Total Lines of Code: ${BOLD}${metrics.totalLoc}${RESET} LOC (avg: ${metrics.avgLoc} lines/file)`);
  lines.push(`   Largest File:        ${BOLD}${metrics.largestFile.filePath || 'None'}${RESET} (${metrics.largestFile.lineCount} lines)`);
  lines.push(`   Molecule Capsules:   ${metrics.moleculeCount} found (${metrics.moleculeCompliantPct}% compliant < 100 lines)`);
  lines.push(`   Custom Hooks:        ${metrics.hookCount} detected`);
  lines.push(`${CYAN}======================================================================${RESET}\n`);

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
  lines.push(`${YELLOW}======================================================================${RESET}`);
  lines.push(`${BOLD}${YELLOW}   HIGH & MEDIUM HAZARDS (${totalCount} TOTAL) : ARCHITECTURE DEBTS${RESET}`);
  lines.push(`${DIM}   Saturation, complex control flow booleans, and raw inline styles${RESET}`);
  lines.push(`${YELLOW}======================================================================${RESET}`);

  if (totalCount === 0) {
    lines.push(`   ${GREEN}✔ Zero high or medium architecture hazards detected.${RESET}`);
  } else {
    if (high.length > 0) {
      lines.push(`\n   ${BOLD}--- High Severity (${high.length} items) ---${RESET}`);
      high.forEach((v, idx) => {
        lines.push(`   ${RED}[#${idx + 1} HIGH]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }

    if (medium.length > 0) {
      lines.push(`\n   ${BOLD}--- Medium Severity (${medium.length} items) ---${RESET}`);
      medium.forEach((v, idx) => {
        lines.push(`   ${YELLOW}[#${idx + 1} MED]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }
  }
  lines.push(`${YELLOW}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatLowSection = (report) => {
  const { violations } = report;
  const { low } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   LOW & HYGIENE ISSUES (${low.length} TOTAL) : TYPOGRAPHY & LOGGING${RESET}`);
  lines.push(`${DIM}   Em dash typography violations and unguarded console statements${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);

  if (low.length === 0) {
    lines.push(`   ${GREEN}✔ Zero typography or logging hygiene issues detected.${RESET}`);
  } else {
    low.forEach((v, idx) => {
      lines.push(`   ${DIM}[#${idx + 1} LOW]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }
  lines.push(`${CYAN}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatPillarsSection = (report) => {
  const { pillars } = report;
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   7-PILLAR ARCHITECTURAL COMPLIANCE MATRIX${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`   ${DIM}Pillar Name                                   Status     Violations${RESET}`);
  lines.push(`   ${DIM}------------------------------------------------------------------${RESET}`);
  for (const [pillarName, data] of Object.entries(pillars)) {
    const padName = pillarName.padEnd(45, ' ');
    const badge = getStatusBadge(data.status).padEnd(16, ' ');
    const countStr = data.violations === 0 ? `${GREEN}0${RESET}` : `${RED}${data.violations}${RESET}`;
    lines.push(`   ${padName} ${badge} ${countStr}`);
  }
  lines.push(`${CYAN}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatHotspotsSection = (report) => {
  const { hotspots } = report;
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   TOP REFACTORING HOTSPOTS (PRIORITY RANKING)${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);

  if (hotspots.length === 0) {
    lines.push(`   ${GREEN}✔ Zero hotspot files. All files stay within architectural budgets.${RESET}`);
  } else {
    hotspots.forEach((h, idx) => {
      const monolithBadge = resolveHotspotBadge(h.lineCount);
      lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards)${monolithBadge}`);
    });
  }
  lines.push(`${CYAN}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const formatContextAnalysisSection = (report) => {
  const { contextAnalysis } = report;
  const riskColor = resolveRiskColor(contextAnalysis.riskLevel);
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   CONTEXT ROT & TOKEN BURN ANALYTICS${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`   Estimated Codebase Tokens:  ~${contextAnalysis.estimatedTokens.toLocaleString()} tokens`);
  lines.push(`   Estimated Monolith Bloat:   ~${contextAnalysis.estimatedExcessTokens.toLocaleString()} tokens`);
  lines.push(`   Target Architecture Cut:    ${BOLD}${contextAnalysis.potentialSavingsPct}%${RESET} token reduction potential`);
  lines.push(`   Agent Hallucination Risk:   ${riskColor}${BOLD}${contextAnalysis.riskLevel}${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}\n`);

  return lines.join('\n');
};

export const getChemicalXAsciiBanner = () => {
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

  for (const line of art) {
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
    lines.push(out);
  }

  const subtitle = 'Architectural guardrails to eliminate token burn and AI hallucinations.';
  const pad = ' '.repeat(Math.max(0, Math.floor((maxLen - subtitle.length) / 2)));
  lines.push(`${pad}\x1b[2m${subtitle}\x1b[0m\n`);
  return lines.join('\n');
};

export const formatTerminalReport = (report) => {
  const lines = [];

  lines.push('');
  lines.push(getChemicalXAsciiBanner());
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   CHEMICAL X PROTOCOL : FULL CODEBASE ARCHITECTURAL AUDIT REPORT${RESET}`);
  lines.push(`${DIM}   Molecular Architecture Standards & Context Hazard Verification${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);

  lines.push(formatScorecardSection(report));
  lines.push(formatContextAnalysisSection(report));
  lines.push(formatPillarsSection(report));
  lines.push(formatHotspotsSection(report));
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
  const debtsDesc = debtsTotal > 0 ? `${YELLOW}${BOLD}${debtsTotal}${RESET}` : `${GREEN}0${RESET}`;
  lines.push(`   High/Med Debts:          ${debtsDesc}`);
  const lowDesc = low.length > 0 ? `${DIM}${low.length}${RESET}` : `${GREEN}0${RESET}`;
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
    lines.push(`   ${BOLD}${YELLOW}⚠️  HIGH & MEDIUM HAZARDS (${debtsTotal}) : ARCHITECTURE DEBTS${RESET}`);
    [...high, ...medium].forEach((v, idx) => {
      const isHigh = v.severity === 'HIGH';
      const badge = isHigh ? `${RED}[#${idx + 1} HIGH]${RESET}` : `${YELLOW}[#${idx + 1} MED]${RESET}`;
      lines.push(`   ${badge} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }

  if (low.length > 0) {
    lines.push(`   ${BOLD}${DIM}🧹 LOW & HYGIENE ISSUES (${low.length})${RESET}`);
    low.forEach((v, idx) => {
      lines.push(`   ${DIM}[#${idx + 1} LOW]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
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
  lines.push(`   Capsule Compliance:      ${BOLD}${GREEN}${metrics.moleculeCompliantPct}%${RESET} molecules compliant (< 100 LOC)`);
  lines.push(`   Total Files Scanned:     ${metrics.scannedFiles} source files (${metrics.totalLoc} total LOC)`);
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
    lines.push(`   ${GREEN}✔${RESET} Zero Extreme Monoliths (0 files >= 2,000 LOC)`);
  }
  const hasSevereMonolith = hotspots.some((h) => h.lineCount >= 1000);
  if (!hasSevereMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Severe Monoliths (0 files >= 1,000 LOC)`);
  }
  if (contextAnalysis.riskLevel === 'LOW') {
    lines.push(`   ${GREEN}✔${RESET} Low Context Hazard & Token Burn Risk`);
  }

  lines.push(`\n${GREEN}======================================================================${RESET}\n`);
  return lines.join('\n');
};
