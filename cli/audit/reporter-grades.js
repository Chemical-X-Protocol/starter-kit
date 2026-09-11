import {
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
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
  groupViolationsBySeverity
} from './reporter-utils.js';

export const formatGradeFSection = (report) => {
  const { violations, hotspots, pillars } = report;
  const { critical } = groupViolationsBySeverity(violations);
  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000);
  const failedPillars = Object.entries(pillars || {}).filter(([_, p]) => p.status === 'FAILED');
  const lines = [];

  lines.push('');
  lines.push(`${RED}======================================================================${RESET}`);
  lines.push(`${BOLD}${RED}   GRADE F : CRITICAL ARCHITECTURAL HAZARDS & EXTREME MONOLITHS${RESET}`);
  lines.push(`${DIM}   Immediate action required: >2,000 LOC monoliths, render hacks, mock data${RESET}`);
  lines.push(`${RED}======================================================================${RESET}`);
  lines.push(`   Critical Violations:  ${critical.length > 0 ? `${RED}${BOLD}${critical.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`   Extreme Monoliths:    ${extremeMonoliths.length > 0 ? `${RED}${BOLD}${extremeMonoliths.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`   Failed Pillars:       ${failedPillars.length > 0 ? `${RED}${BOLD}${failedPillars.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`${RED}----------------------------------------------------------------------${RESET}`);

  const totalGradeFItems = critical.length + extremeMonoliths.length + failedPillars.length;
  if (totalGradeFItems === 0) {
    lines.push(`\n   ${GREEN}✔ Outstanding! Zero Grade F hazards detected.${RESET}`);
    lines.push(`   ${DIM}Codebase is free of extreme monoliths (>2k LOC) and critical violations.${RESET}`);
  } else {
    if (critical.length > 0) {
      lines.push(`\n   ${BOLD}${RED}🚨 CRITICAL AST VIOLATIONS (${critical.length}):${RESET}`);
      critical.forEach((v, idx) => {
        lines.push(`   ${RED}[#${idx + 1} CRITICAL]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }

    if (extremeMonoliths.length > 0) {
      lines.push(`   ${BOLD}${RED}💣 EXTREME MONOLITHS (>= 2,000 LINES):${RESET}`);
      lines.push(`   ${DIM}Massive token burn files causing severe context rot and agent hallucination.${RESET}`);
      extremeMonoliths.forEach((h, idx) => {
        lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards) ${RED}[EXTREME MONOLITH]${RESET}`);
      });
      lines.push('');
    }

    if (failedPillars.length > 0) {
      lines.push(`   ${BOLD}${RED}🏛️  FAILED PILLARS (CRITICAL INFECTIONS):${RESET}`);
      for (const [name, p] of failedPillars) {
        lines.push(`   ✕ ${YELLOW}${name}${RESET}: ${p.violations} violations (${p.critical} Critical, ${p.high} High, ${p.medium} Med)`);
      }
      lines.push('');
    }
  }

  const promptF = buildGradeFPrompt(report);
  if (promptF) {
    lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (GRADE F HAZARDS)', promptF));
  }

  lines.push(`${RED}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatGradeDSection = (report) => {
  const { violations, hotspots, pillars } = report;
  const { high } = groupViolationsBySeverity(violations);
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000);
  const warnPillars = Object.entries(pillars || {}).filter(([_, p]) => p.status === 'WARN');
  const lines = [];

  lines.push('');
  lines.push(`${ORANGE}======================================================================${RESET}`);
  lines.push(`${BOLD}${ORANGE}   GRADE D : HIGH SEVERITY DEBTS & SEVERE MONOLITHS${RESET}`);
  lines.push(`${DIM}   Refactoring priorities: 1,000 to 1,999 LOC files and hook saturation > 5${RESET}`);
  lines.push(`${ORANGE}======================================================================${RESET}`);
  lines.push(`   High Severity Debts:  ${high.length > 0 ? `${ORANGE}${BOLD}${high.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`   Severe Monoliths:     ${severeMonoliths.length > 0 ? `${ORANGE}${BOLD}${severeMonoliths.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`   Degraded Pillars:     ${warnPillars.length > 0 ? `${ORANGE}${BOLD}${warnPillars.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`${ORANGE}----------------------------------------------------------------------${RESET}`);

  const totalGradeDItems = high.length + severeMonoliths.length + warnPillars.length;
  if (totalGradeDItems === 0) {
    lines.push(`\n   ${GREEN}✔ Zero Grade D debts detected.${RESET}`);
    lines.push(`   ${DIM}No severe monoliths (1k-2k LOC) or saturated hook anti-patterns.${RESET}`);
  } else {
    if (high.length > 0) {
      lines.push(`\n   ${BOLD}${ORANGE}⚠️  HIGH SEVERITY VIOLATIONS (${high.length}):${RESET}`);
      high.forEach((v, idx) => {
        lines.push(`   ${ORANGE}[#${idx + 1} HIGH]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }

    if (severeMonoliths.length > 0) {
      lines.push(`   ${BOLD}${ORANGE}🔥 SEVERE MONOLITHS (1,000 - 1,999 LINES):${RESET}`);
      severeMonoliths.forEach((h, idx) => {
        lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards) ${ORANGE}[SEVERE MONOLITH]${RESET}`);
      });
      lines.push('');
    }

    if (warnPillars.length > 0) {
      lines.push(`   ${BOLD}${ORANGE}🏛️  DEGRADED PILLARS (MULTIPLE HIGH/MED DEBTS):${RESET}`);
      for (const [name, p] of warnPillars) {
        lines.push(`   ⚠ ${YELLOW}${name}${RESET}: ${p.violations} violations (${p.high} High, ${p.medium} Med)`);
      }
      lines.push('');
    }
  }

  const promptD = buildGradeDPrompt(report);
  if (promptD) {
    lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (GRADE D DEBTS)', promptD));
  }

  lines.push(`${ORANGE}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatGradeCSection = (report) => {
  const { violations, hotspots } = report;
  const { medium } = groupViolationsBySeverity(violations);
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000);
  const lines = [];

  lines.push('');
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`${BOLD}${CYAN}   GRADE C : MEDIUM SEVERITY DEBTS & MONOLITHIC DRIFT${RESET}`);
  lines.push(`${DIM}   Architecture debts: 500 to 999 LOC files and raw inline style attributes${RESET}`);
  lines.push(`${CYAN}======================================================================${RESET}`);
  lines.push(`   Medium Debts:         ${medium.length > 0 ? `${YELLOW}${BOLD}${medium.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`   Warning Monoliths:    ${warningMonoliths.length > 0 ? `${YELLOW}${BOLD}${warningMonoliths.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`${CYAN}----------------------------------------------------------------------${RESET}`);

  const totalGradeCItems = medium.length + warningMonoliths.length;
  if (totalGradeCItems === 0) {
    lines.push(`\n   ${GREEN}✔ Zero Grade C debts detected.${RESET}`);
    lines.push(`   ${DIM}All files remain under 500 lines with clean styling and handlers.${RESET}`);
  } else {
    if (medium.length > 0) {
      lines.push(`\n   ${BOLD}${CYAN}⚡ MEDIUM SEVERITY VIOLATIONS (${medium.length}):${RESET}`);
      medium.forEach((v, idx) => {
        lines.push(`   ${YELLOW}[#${idx + 1} MED]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
        lines.push(`      Hazard:    ${v.hazard}`);
        lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
      });
    }

    if (warningMonoliths.length > 0) {
      lines.push(`   ${BOLD}${CYAN}⚠️  WARNING MONOLITHS (500 - 999 LINES):${RESET}`);
      warningMonoliths.forEach((h, idx) => {
        lines.push(`   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards) ${DIM}[MONOLITH WARNING]${RESET}`);
      });
      lines.push('');
    }
  }

  const promptC = buildGradeCPrompt(report);
  if (promptC) {
    lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (GRADE C DEBTS)', promptC));
  }

  lines.push(`${CYAN}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatGradeBSection = (report) => {
  const { violations } = report;
  const { low } = groupViolationsBySeverity(violations);
  const lines = [];

  lines.push('');
  lines.push(`${YELLOW}======================================================================${RESET}`);
  lines.push(`${BOLD}${YELLOW}   GRADE B : LOW SEVERITY HYGIENE & MINOR CODE SMELLS${RESET}`);
  lines.push(`${DIM}   Hygiene & polish: Em dash typography leaks and unguarded console logging${RESET}`);
  lines.push(`${YELLOW}======================================================================${RESET}`);
  lines.push(`   Low Hygiene Issues:   ${low.length > 0 ? `${YELLOW}${BOLD}${low.length}${RESET}` : `${GREEN}0${RESET}`}`);
  lines.push(`${YELLOW}----------------------------------------------------------------------${RESET}`);

  if (low.length === 0) {
    lines.push(`\n   ${GREEN}✔ Outstanding hygiene! Zero Grade B issues detected.${RESET}`);
    lines.push(`   ${DIM}Zero em dashes and zero unguarded console statements found.${RESET}`);
  } else {
    lines.push(`\n   ${BOLD}${YELLOW}ℹ️  LOW HYGIENE VIOLATIONS (${low.length}):${RESET}`);
    low.forEach((v, idx) => {
      lines.push(`   ${YELLOW}[#${idx + 1} LOW]${RESET} [${v.rule}] ${YELLOW}${v.filePath}:${v.line}:${v.column}${RESET}`);
      lines.push(`      Hazard:    ${v.hazard}`);
      lines.push(`      Directive: ${CYAN}${v.directive}${RESET}\n`);
    });
  }

  const promptB = buildGradeBPrompt(report);
  if (promptB) {
    lines.push(formatPromptBox('🤖 AI AGENT REFACTORING PROMPT (GRADE B HYGIENE)', promptB));
  }

  lines.push(`${YELLOW}======================================================================${RESET}\n`);
  return lines.join('\n');
};

export const formatGradeASection = (report) => {
  const { metrics, health, pillars, hotspots, contextAnalysis } = report;
  const passedPillars = Object.entries(pillars || {}).filter(([_, p]) => p.status === 'PASSED');
  const lines = [];

  lines.push('');
  lines.push(`${GREEN}======================================================================${RESET}`);
  lines.push(`${BOLD}${GREEN}   GRADE A : COMPLIANT ARCHITECTURE & PASSING PILLARS${RESET}`);
  lines.push(`${DIM}   Molecular Architecture verified clean areas and crystalline modules${RESET}`);
  lines.push(`${GREEN}======================================================================${RESET}`);
  lines.push(`   Molecular Health Score:  ${BOLD}${GREEN}${health.score}/100${RESET} [Grade: ${BOLD}${GREEN}${health.grade}${RESET}]`);
  lines.push(`   Passing Pillars:       ${BOLD}${GREEN}${passedPillars.length} / 7 Pillars PASSED${RESET}`);
  lines.push(`   Capsule Compliance:    ${BOLD}${GREEN}${metrics.moleculeCompliantPct}%${RESET} compliant (< 100 LOC)`);
  lines.push(`${GREEN}----------------------------------------------------------------------${RESET}`);

  lines.push(`\n   ${BOLD}${GREEN}✔ COMPLIANT PILLARS (${passedPillars.length} / 7):${RESET}`);
  if (passedPillars.length === 0) {
    lines.push(`   ${YELLOW}No pillars are currently 100% compliant.${RESET}\n`);
  } else {
    for (const [name] of passedPillars) {
      lines.push(`   ${GREEN}✔${RESET} ${name} ${DIM}(0 violations)${RESET}`);
    }
    lines.push('');
  }

  lines.push(`   ${BOLD}${CYAN}STANDARDS MET & CLEAN CODEBASE ASSETS:${RESET}`);
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
