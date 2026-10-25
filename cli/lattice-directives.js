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
  { cmd: 'npx chemx scratch <name>', desc: 'Path of a file in your own git-ignored scratch directory (.chemx/scratch/<handle>/); never write one-off scripts to a shared scratchpad' },
  { cmd: 'npx chemx worktree add <path> -b <branch> --link-modules', desc: 'Make a worktree with node_modules ready; remove it later with chemx worktree remove <path>' },
  { cmd: 'npx chemx mutate <file> --apply "s/a/b/" --then "<command>"', desc: 'Run a command against a temporarily changed file; the original is always restored byte for byte' },
  { cmd: 'npx chemx run -- <command>', desc: 'Run a long non-chemx command (a plugin test runner, a script) while your file leases are renewed every minute' },
  { cmd: 'npx chemx wait --task=<id> | --lock-free=<file> | --verify-idle', desc: 'Block until a task is done, a file lease is free or no verify runs; never sleep-poll' },
  { cmd: 'npx chemx wait --job=<pid> | --post-matching=<text> [--from=@handle]', desc: 'Block until a backgrounded chemx process ends (chemx test ... & chemx wait --job=$!; exits with its code) or a feed post matches' },
  { cmd: 'npx chemx task add --from <file.json|yaml> [--dry-run]', desc: 'File an epic and its children in one transaction (chemx task is chemx team task); a long brief: chemx team brief <id> --file <md>' },
  { cmd: 'npx chemx commit <files> -m "<subject> (#<id>)" [--board=<dir>] [--no-skip-ci]', desc: 'Commit only the listed files, lease-checked and recorded on the task; --board names the board when you commit from a worktree' },
  { cmd: 'npx chemx ci <pr> --wait', desc: 'Poll a pull request\'s checks and merge state; exit 0 all passed, 1 a check failed, 3 pending or none reported yet' },
  { cmd: 'npx chemx changelog --check', desc: 'Validate your docs/changelog.d/<ticket>.md fragment; chemx changelog folds the fragments into Unreleased' },
  { cmd: 'npx chemx verify --json', desc: 'Execute silent full AST audit + typecheck + test suite' }
];
