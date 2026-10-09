import { SIZE_LABELS, hasSizeClass, isAtLeastSize } from './line-budgets.js';
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
  resolveHotspotBadge,
  resolveReportMoleculeLineLimit
} from './reporter-utils.js';
import { renderGroupedViolationsTerminal } from './reporter-grouping.js';
import { buildMasterPrompt, formatPromptBox } from './prompts.js';

const isDegradedPillar = ([_, pillar]) => pillar.status !== 'PASSED';
const isPassedPillar = ([_, pillar]) => pillar.status === 'PASSED';
const isExtremeMonolith = hasSizeClass('extreme');
const isSevereMonolith = (h) => isAtLeastSize(h.lineCount, 'severe');

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

  const hasNoFindings = violations.length === 0 && hotspots.length === 0;
  if (hasNoFindings) {
    lines.push(`\n   ${GREEN}${BOLD}✔ ZERO FAILURES DETECTED!${RESET}`);
    lines.push(`   All ${Object.keys(pillars).length} Chemical X Molecular Architecture Pillars are 100% Compliant.\n`);
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

  const hasCritical = critical.length > 0;
  if (hasCritical) {
    lines.push(`\n   ${BOLD}${RED}🚨 CRITICAL HAZARDS (${critical.length}) : IMMEDIATE ACTION REQUIRED${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal(critical));
  }

  const hasDebts = debtsTotal > 0;
  if (hasDebts) {
    lines.push(`   ${BOLD}${ORANGE}⚠️  HIGH & MEDIUM HAZARDS (${debtsTotal}) : ARCHITECTURE DEBTS${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal([...high, ...medium]));
  }

  const hasLow = low.length > 0;
  if (hasLow) {
    lines.push(`   ${BOLD}${YELLOW}🧹 LOW & HYGIENE ISSUES (${low.length})${RESET}\n`);
    lines.push(renderGroupedViolationsTerminal(low));
  }

  const failedPillars = Object.entries(pillars).filter(isDegradedPillar);
  const hasFailedPillars = failedPillars.length > 0;
  if (hasFailedPillars) {
    lines.push(`   ${BOLD}${RED}🏛️  FAILED / DEGRADED PILLARS (${failedPillars.length})${RESET}`);
    for (const [name, p] of failedPillars) {
      lines.push(`   ✕ ${YELLOW}${name}${RESET}: ${p.violations} violations (${p.critical} Critical, ${p.high} High, ${p.medium} Med)`);
    }
    lines.push('');
  }

  const hasHotspots = hotspots.length > 0;
  if (hasHotspots) {
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
  const moleculeLimit = resolveReportMoleculeLineLimit(report);
  const passedPillars = Object.entries(pillars).filter(isPassedPillar);
  const lines = [];

  lines.push('');
  lines.push(`${GREEN}======================================================================${RESET}`);
  lines.push(`${BOLD}${GREEN}   PASSED & COMPLIANT CHECKS : CLEAN ARCHITECTURE STANDARDS${RESET}`);
  lines.push(`${DIM}   Consolidated breakdown of verified compliant areas${RESET}`);
  lines.push(`${GREEN}======================================================================${RESET}`);

  lines.push(`   Molecular Health Score:    ${BOLD}${GREEN}${health.score}/100${RESET} [Grade: ${BOLD}${GREEN}${health.grade}${RESET}]`);
  lines.push(`   Passing Pillars:         ${BOLD}${GREEN}${passedPillars.length} / ${Object.keys(pillars).length} Pillars PASSED${RESET}`);
  lines.push(`   Capsule Compliance:      ${BOLD}${GREEN}${metrics.moleculeCompliantPct}%${RESET} molecules compliant (<= ${moleculeLimit} lines of code)`);
  lines.push(`   Total Files Scanned:     ${metrics.scannedFiles} source files (${metrics.totalLoc} total lines of code)`);
  lines.push(`${GREEN}----------------------------------------------------------------------${RESET}`);

  lines.push(`\n   ${BOLD}${GREEN}✔ COMPLIANT ARCHITECTURAL PILLARS:${RESET}`);
  const hasNoPassedPillars = passedPillars.length === 0;
  if (hasNoPassedPillars) {
    lines.push(`   ${YELLOW}No pillars are completely hazard-free.${RESET}\n`);
  } else {
    for (const [name] of passedPillars) {
      lines.push(`   ${GREEN}✔${RESET} ${name} ${DIM}(0 violations)${RESET}`);
    }
    lines.push('');
  }

  lines.push(`   ${BOLD}${CYAN}STANDARDS MET & CLEAN AREAS:${RESET}`);
  const isFullyCompliant = metrics.moleculeCompliantPct === 100;
  if (isFullyCompliant) {
    lines.push(`   ${GREEN}✔${RESET} 100% Molecule Capsule Limit (<= ${moleculeLimit} lines per molecule)`);
  }
  const hasExtremeMonolith = hotspots.some(isExtremeMonolith);
  if (!hasExtremeMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Extreme Monoliths (0 files ${SIZE_LABELS.extreme} lines of code)`);
  }
  const hasSevereMonolith = hotspots.some(isSevereMonolith);
  if (!hasSevereMonolith) {
    lines.push(`   ${GREEN}✔${RESET} Zero Severe Monoliths (0 files ${SIZE_LABELS.severe} lines of code)`);
  }
  const isLowContextRisk = contextAnalysis.riskLevel === 'LOW';
  if (isLowContextRisk) {
    lines.push(`   ${GREEN}✔${RESET} Low Context Hazard & Token Burn Risk`);
  }

  lines.push(`\n${GREEN}======================================================================${RESET}\n`);
  return lines.join('\n');
};
