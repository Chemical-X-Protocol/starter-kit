/**
 * tesseract-manifesto.js: Chemical X medium architecture & AI directives.
 * Single responsibility: Format the AI-Human symbiosis manifesto and action protocol.
 */

import { ANSI } from './theme.js';
import { DIRECTIVES, JARVIS_OPERATIONS } from './lattice-directives.js';

export { DIRECTIVES, JARVIS_OPERATIONS };

export const renderManifesto = () => {
  const B = ANSI.BOLD;
  const C = ANSI.CYAN;
  const G = ANSI.GOLD;
  const M = ANSI.MINT;
  const P = ANSI.PINK;
  const R = ANSI.RESET;
  const D = ANSI.DIM;

  const lines = [
    `${B}${G}THE CHEMICAL X MEDIUM : HUMAN-AI SYMBIOSIS HYPOTHESIS${R}`,
    `${D}Traditional codebases fail AI agents: context rots, tokens burn, and monoliths collapse.${R}`,
    `${D}Chemical X transforms code into a crystalline, AST-indexed molecular program.${R}`,
    `${D}Both human and AI share a single source of truth with zero cognitive friction.${R}`,
    '',
    `${B}${C}THE 7 INVIOLABLE DIRECTIVES OF THE MEDIUM:${R}`
  ];

  for (const dir of DIRECTIVES) {
    lines.push(`  ${P}*${R} ${B}${dir.id}:${R} ${dir.desc}`);
  }

  lines.push(
    '',
    `${B}${M}JARVIS PROTOCOL ACTIVE : AGENT MISSION DIRECTIVES${R}`,
    `${D}Welcome, Agent. You are now interfaced with the Chemical X Neural Matrix.${R}`,
    `${D}Follow these operational steps to execute your mission with surgical precision:${R}`
  );

  for (const op of JARVIS_OPERATIONS) {
    lines.push(`  ${G}>>${R} ${C}${op.cmd}${R}`);
    lines.push(`     ${D}${op.desc}${R}`);
  }

  return lines.join('\n');
};
