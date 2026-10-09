// Command schema entries for the verify group. Assembled in commands-schema.js.
export const VERIFY_COMMANDS = [
  {
    name: 'verify',
    aliases: ['check:all'],
    group: 'verify',
    brief: 'Audit, typecheck and tests',
    usage: 'chemx verify [options]',
    summary: 'Runs the full verification pipeline: AST audit, typecheck and test suite.',
    description: 'Compact single-card verification; silent when green.',
    flags: [
      { flag: '--dir=<path>', desc: 'Target directory (default: .chemxrc "scope", else project root)' },
      { flag: '--build', desc: 'Include production build audit step' },
      { flag: '--json', desc: 'Output the status card as JSON' }
    ],
    examples: ['chemx verify', 'chemx verify --json']
  },
  {
    name: 'test',
    aliases: ['tests', 'check:test'],
    group: 'verify',
    brief: 'Run tests, failures only',
    usage: 'chemx test [target] [options] [-- <command>]',
    summary: 'Run the project test suite and report only failures.',
    description: 'Detects the test runner and suppresses passing output.',
    flags: [
      { flag: '--json', desc: 'Output test summary as minified JSON' },
      { flag: '--raw', desc: 'Do not suppress passing test output' }
    ],
    examples: ['chemx test', 'chemx test src/store.spec.ts --json']
  },
  {
    name: 'typecheck',
    aliases: ['check:types', 'tsc'],
    group: 'verify',
    brief: 'Typecheck, errors only',
    usage: 'chemx typecheck [options] [-- <command>]',
    summary: 'Run the project type checker and report only diagnostics.',
    description: 'Uses the project typecheck script when present.',
    flags: [
      { flag: '--json', desc: 'Output diagnostics as minified JSON' },
      { flag: '--raw', desc: 'Do not capture or format output' }
    ],
    examples: ['chemx typecheck', 'chemx typecheck --json']
  },
  {
    name: 'lint',
    aliases: ['check:lint', 'eslint'],
    group: 'verify',
    brief: 'ESLint, grouped diagnostics',
    usage: 'chemx lint [path] [options] [-- <command>]',
    summary: 'Token-conserving linter runner with automatic fix.',
    description: 'Executes ESLint with grouped diagnostics, target scoping and --fix support.',
    flags: [
      { flag: '--fix', desc: 'Automatically fix fixable lint errors' },
      { flag: '--json', desc: 'Output structured diagnostics as JSON' },
      { flag: '--raw', desc: 'Do not capture or format output' }
    ],
    examples: ['chemx lint', 'chemx lint --fix', 'chemx lint src/app.vue --fix']
  },
  {
    name: 'build',
    aliases: ['run', 'wrap'],
    group: 'verify',
    brief: 'Build with grouped errors',
    usage: 'chemx build [options] [-- <command>]',
    summary: 'Run the build and catalog its diagnostics.',
    description: 'Suppresses compiler noise and groups diagnostics into categories.',
    flags: [
      { flag: '--json', desc: 'Minified JSON format with categorised diagnostics' },
      { flag: '--command="<cmd>"', desc: 'Explicit build command (default: npm run build)' }
    ],
    examples: ['chemx build', 'chemx build -- vite build']
  },
  {
    name: 'audit',
    aliases: [],
    group: 'verify',
    brief: 'Architectural AST audit',
    usage: 'chemx audit [directory] [options]',
    summary: 'Execute the full architectural AST audit.',
    description: 'Validates structural weight, line budgets and tier rules, and populates the SQLite index.',
    flags: [
      { flag: '--json', desc: 'Output the audit summary as JSON (--full for the complete report)' },
      { flag: '--triage', desc: 'Auto-convert unassigned hazards into team tasks' },
      { flag: '--rebaseline', desc: 'Record per-rule counts to chemx-ratchet.json (full scans only)' },
      { flag: '--strict', desc: 'Fail on any architectural hazard' },
      { flag: '--markdown', desc: 'Generate a Markdown audit report' },
      { flag: '--unroll', desc: 'Print the full terminal report' },
      { flag: '--git, --changed', desc: 'Audit only files changed in git' },
      { flag: '--min-grade=<A|B|C|D|F>', desc: 'Minimum acceptable architectural grade' }
    ],
    examples: ['chemx audit', 'chemx audit --json', 'chemx audit --strict --min-grade=A']
  },
  {
    name: 'trend',
    aliases: ['trends'],
    group: 'verify',
    brief: 'Audit score history',
    usage: 'chemx trend [options]',
    summary: 'Show audit score history recorded in the index.',
    description: 'Reads audit snapshots from .chemx/index.db.',
    flags: [{ flag: '--json', desc: 'Output snapshots as JSON' }],
    examples: ['chemx trend']
  },
  {
    name: 'badge',
    aliases: ['badges'],
    group: 'verify',
    brief: 'Write the grade badge SVG',
    usage: 'chemx badge [options]',
    summary: 'Generate the architectural grade badge.',
    description: 'Writes chemx-badge.svg from the latest audit.',
    flags: [],
    examples: ['chemx badge']
  }
];
