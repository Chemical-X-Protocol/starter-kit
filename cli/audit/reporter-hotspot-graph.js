import { ANSI } from '../theme.js';

export const formatHotspotGraphReport = (graphResult) => {
  const { count, hotspots = [] } = graphResult;
  const hasHotspots = Array.isArray(hotspots) && hotspots.length > 0;
  if (!hasHotspots) {
    return `   ${ANSI.LIME}✔ Zero cascading violation hotspots detected.${ANSI.RESET}\n`;
  }

  const lines = [
    `   ${ANSI.BOLD}${ANSI.PINK}Cascading Violation Hotspot Graph (${count} files with propagating debt)${ANSI.RESET}`
  ];

  for (let idx = 0; idx < hotspots.length; idx++) {
    const h = hotspots[idx];
    const rank = idx + 1;
    const blast = h.blastRadius;
    const critStr = h.criticalCount > 0 ? `${ANSI.RED}${h.criticalCount} crit${ANSI.RESET}, ` : '';
    const highStr = h.highCount > 0 ? `${ANSI.GOLD}${h.highCount} high${ANSI.RESET}, ` : '';
    const medStr = `${h.medCount} med`;

    lines.push(
      `     ${ANSI.BOLD}#${rank} ${ANSI.CYAN}${h.filePath}${ANSI.RESET} [${h.tier}, ${h.lines} LOC]`
    );
    lines.push(
      `        ${ANSI.RED}Cascading Risk: ${h.cascadingRisk} pts${ANSI.RESET} (Violations: ${critStr}${highStr}${medStr})`
    );
    lines.push(
      `        ${ANSI.DIM}Blast Radius: ${blast.totalImpact} consumers (${blast.directConsumers} direct, ${blast.impactedTests} tests across ${blast.depth} hops)${ANSI.RESET}`
    );
  }

  return lines.join('\n') + '\n';
};
