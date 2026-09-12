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
  resolveHotspotBadge
} from './reporter-utils.js';
import { renderGroupedViolationsTerminal } from './reporter-grouping.js';
import { buildMasterPrompt, formatPromptBox } from './prompts.js';

const isDegradedPillar = ([_, pillar]) => pillar.status !== 'PASSED';
const isPassedPillar = ([_, pillar]) => pillar.status === 'PASSED';
const isExtremeMonolith = (h) => h.lineCount >= 2000;
const isSevereMonolith = (h) => h.lineCount >= 1000;

const formatFailureHotspot = (h, idx) => {
  const monolithBadge = resolveHotspotBadge(h.lineCount);
  return `   [#${idx + 1}] ${YELLOW}${h.filePath}${RESET} (${h.lineCount} lines, ${h.violationCount} hazards)${monolithBadge}`;
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
    lines.push(`\n   ${BOLD}${RED}🚨 CRITICAL HAZARDS (${critical.length}) : IMMEDIATE ACTION REQUIRED${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal(critical));
  }

  if (debtsTotal > 0) {
    lines.push(`   ${BOLD}${ORANGE}⚠️  HIGH & MEDIUM HAZARDS (${debtsTotal}) : ARCHITECTURE DEBTS${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal([...high, ...medium]));
  }

  if (low.length > 0) {
    lines.push(`   ${BOLD}${YELLOW}🧹 LOW & HYGIENE ISSUES (${low.length})${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal(low));
  }

  const failedPillars = Object.entries(pillars).filter(isDegradedPillar);
  if (failedPillars.length > 0) {
    lines.push(`   ${BOLD}${RED}🏛️  FAILED / DEGRADED PILLARS (${failedPillars.length})${RESET}`);
    for (const [name, p] of failedPillars) {
      lines.push(`   ✕ ${YELLOW}${name}${RESET}: ${p.violations} violations (${p.critical} Critical, ${p.high} High, ${p.medium} Med)`);
    }
    lines.push('');
  }

  if (hotspots.length > 0) {
    lines.push(`   ${BOLD}${YELLOW}🔥 REFACTORING HOTSPOTS (${hotspots.length})${RESET}`);
    for (let idx = 0; idx < hotspots.length; idx++) {
      lines.push(formatFailureHotspot(hotspots[idx], idx));
    }
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
  const passedPillars = Object.entries(pillars).filter(isPassedPillar);
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
  const hasExtremeMonolith = hotspots.some(isExtremeMonolith);
  if (!hasExtremeMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Extreme Monoliths (0 files >= 2,000 lines of code)`);
  }
  const hasSevereMonolith = hotspots.some(isSevereMonolith);
  if (!hasSevereMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Severe Monoliths (0 files >= 1,000 lines of code)`);
  }
  if (contextAnalysis.riskLevel === 'LOW') {
    lines.push(`   ${GREEN}✔${RESET} Low Context Hazard & Token Burn Risk`);
  }

  lines.push(`\n${GREEN}======================================================================${RESET}\n`);
  return lines.join('\n');
};
