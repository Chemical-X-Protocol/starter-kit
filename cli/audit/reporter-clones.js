import { ANSI } from '../theme.js';

export const formatCloneReport = (cloneResult) => {
  const { count, threshold, exactClones = [], nearClones = [], pairs = [] } = cloneResult;
  const hasPairs = Array.isArray(pairs) && pairs.length > 0;
  if (!hasPairs) {
    return `   ${ANSI.LIME}✔ Zero duplicate clone hazards detected (threshold: ${threshold})${ANSI.RESET}\n`;
  }

  const lines = [
    `   ${ANSI.BOLD}${ANSI.PINK}Semantic Clone Detection (${count} candidate pairs >= ${threshold})${ANSI.RESET}`
  ];

  const hasExact = exactClones.length > 0;
  if (hasExact) {
    lines.push(`     ${ANSI.RED}${ANSI.BOLD}Hazard: ${exactClones.length} high-similarity duplicate(s) (>= 0.95)${ANSI.RESET}`);
    for (const p of exactClones) {
      const simPct = Math.round(p.similarity * 100);
      lines.push(`       ${ANSI.RED}[${simPct}%]${ANSI.RESET} ${p.fileA} <-> ${p.fileB}`);
    }
  }

  const hasNear = nearClones.length > 0;
  if (hasNear) {
    lines.push(`     ${ANSI.GOLD}Harmonization Candidates: ${nearClones.length} structural clone(s)${ANSI.RESET}`);
    for (const p of nearClones) {
      const simPct = Math.round(p.similarity * 100);
      lines.push(`       ${ANSI.GOLD}[${simPct}%]${ANSI.RESET} ${p.fileA} <-> ${p.fileB}`);
    }
  }

  return lines.join('\n') + '\n';
};
