/**
 * tesseract-manifesto.js: Chemical X medium architecture & AI directives.
 * Single responsibility: Format the AI-Human symbiosis manifesto and action protocol.
 */

import { ANSI } from './theme.js';

export const DIRECTIVES = [
  { id: '1. MOLECULAR BUDGET', desc: '100 lines is an outer bound per capsule file. Never write monoliths.' },
  { id: '2. ZERO-RAW-DOM RULE', desc: 'Raw HTML tags belong exclusively in Atoms (a-*). Molecules compose Atoms.' },
  { id: '3. TABLE-OF-CONTENTS', desc: 'Page views must be 10-20 line declarative templates assembling slots.' },
  { id: '4. TWO-STAGE BOOLEANS', desc: 'Deconstruct complex multi-clause checks into named atomic booleans.' },
  { id: '5. DATABASE SWARM', desc: 'Tasks, leases, and telemetry live in SQLite (.chemx/index.db). No markdown specs.' },
  { id: '6. SURGICAL AST READ', desc: 'Never dump full files. Request targeted symbols and outlines exclusively.' },
  { id: '7. SILENT VERIFY', desc: 'Verify via silent chemx verify/test/typecheck to preserve context tokens.' }
];

export const JARVIS_OPERATIONS = [
  { cmd: 'npx chemx q "<query>" --hybrid', desc: 'Discover components using hybrid BM25 + Vector RRF ranking' },
  { cmd: 'npx chemx q <target> --blast-radius', desc: 'Calculate transitive blast radius before modifying any capsule' },
  { cmd: 'npx chemx read <file> --symbol=<name> --connections', desc: 'Read target symbol with caller and dependent graph' },
  { cmd: 'npx chemx team task list --as=@agent', desc: 'Inspect active swarm tasks and milestones assigned to you' },
  { cmd: 'npx chemx verify --json', desc: 'Execute silent full AST audit + typecheck + test suite' }
];

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
