/**
 * lattice-directives.js: the Chemical X directives and agent operations as data.
 * Core module: shared by the tesseract HUD (studio) and the --json payload (core).
 */

import { describeLineBudgetPolicy } from './config/profiles.js';

export const DIRECTIVES = [
  { id: '1. MOLECULAR BUDGET', desc: `${describeLineBudgetPolicy()} Never write monoliths.` },
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
