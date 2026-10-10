// Command schema entries for the verify group. Assembled in commands-schema.js.
export const VERIFY_COMMANDS = [
  {
    name: 'verify',
    aliases: ['check:all'],
    group: 'verify',
    brief: 'Run audit, typecheck and tests as one gate',
    usage: 'chemx verify [options]',
    summary: 'Runs the full verification pipeline: AST audit, typecheck and test suite.',
    description: 'Compact single-card verification; silent when green.',
    flags: [
      { flag: '--dir=<path>', desc: 'Target directory (default: .chemxrc "scope", else project root)' },
      { flag: '--build', desc: 'Include production build audit step' },
      { flag: '--changed', desc: 'Audit only changed source files and run only the affected specs; typecheck stays whole-project' },
      { flag: '--base=<rev>', desc: 'With --changed: compare against this revision' },
      { flag: '--json', desc: 'Output the status card as JSON' }
    ],
    examples: ['chemx verify', 'chemx verify --json']
  },
  {
    name: 'test',
    aliases: ['tests', 'check:test'],
    group: 'verify',
    brief: 'Run tests, show failures only',
    usage: 'chemx test [target] [options] [-- <command>]',
    summary: 'Run the project test suite and report only failures.',
    description: 'Detects the test runner and suppresses passing output.',
    flags: [
      { flag: '--json', desc: 'Output test summary as minified JSON' },
      { flag: '--raw', desc: 'Do not suppress passing test output' },
      { flag: '--slow', desc: 'Run only the slow lane (docs/test-lanes.md)' },
      { flag: '--all', desc: 'Run both lanes' },
      { flag: '--changed', desc: 'Run specs affected by changed files, by the import graph' },
      { flag: '--base=<rev>', desc: 'With --changed: compare against this revision' },
      { flag: '--related <files...>', desc: 'Run specs affected by the files you name' },
      { flag: '--depth=<n>', desc: 'With --changed or --related: only specs within n import hops (deeper ones are reported as not run)' },
      { flag: '--profile', desc: 'Time each spec file in its own process, slowest first' },
      { flag: '--top=<n>', desc: 'With --profile: show the n slowest' }
    ],
    examples: ['chemx test', 'chemx test src/store.spec.ts --json']
  },
  {
    name: 'typecheck',
    aliases: ['check:types', 'tsc'],
    group: 'verify',
    brief: 'Typecheck, show errors only',
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
    brief: 'Run ESLint, results grouped by file',
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
    brief: 'Run the build, show grouped errors',
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
    brief: 'Audit architecture rules and grade',
    usage: 'chemx audit [directory] [options]',
    summary: 'Execute the full architectural AST audit.',
    description: 'Validates structural weight, line budgets and tier rules, and populates the SQLite index.',
    flags: [
      { flag: '--json', desc: 'Output the audit summary as JSON (--full for the complete report)' },
      { flag: '--no-triage', desc: 'Skip auto-triage (full-scope audits turn hazards into team tasks by default)' },
      { flag: '--rebaseline', desc: 'Record per-rule counts to chemx-ratchet.json (full scans only)' },
      { flag: '--strict', desc: 'Fail on any architectural hazard' },
      { flag: '--markdown', desc: 'Generate a Markdown audit report' },
      { flag: '--unroll', desc: 'Print the full terminal report' },
      { flag: '--git, --changed', desc: 'Audit only files changed in git' },
      { flag: '--min-grade=<A|B|C|D|F>', desc: 'Minimum acceptable architectural grade' },
      { flag: '--each[=<kind>]', desc: 'Audit each submodule (or =workspaces) as its own scope; --concurrency=N' },
      { flag: '--feed[=<view>]', desc: 'Recorded runs, no audit: history|pillars|scopes; --scope= --since= --limit=' }
    ],
    examples: ['chemx audit', 'chemx audit --json', 'chemx audit --strict --min-grade=A', 'chemx audit --each=submodules', 'chemx audit --feed=scopes --json']
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
    brief: 'Write grade badge SVG',
    usage: 'chemx badge [options]',
    summary: 'Generate the architectural grade badge.',
    description: 'Writes chemx-badge.svg from the latest audit.',
    flags: [],
    examples: ['chemx badge']
  },
  {
    name: 'docs',
    aliases: [],
    group: 'verify',
    brief: 'Check chemx commands named in docs',
    usage: 'chemx docs check [files/dirs...] [--exclude=<path fragment>] [--json]',
    summary: 'Verify that every chemx command a markdown file names exists.',
    description: 'Reads code spans and fenced blocks, never runs anything. Checks command, team subcommand, team task action and MCP action names, and each unquoted --flag against the schema of its command. Pass-through commands (test, build, lint, typecheck) are not flag-checked; team and git wrappers are checked only for typos close to a chemx flag. Short flags, quoted words and argument values are not checked. A misspelled `team lock` action is not detected because any other word there is read as a file path. Exits 1 and prints file:line for each failure, and exits 1 when a named path does not exist or no markdown file was found. With no paths it reads README.md, AGENTS.md, CLAUDE.md, STANDARDS.md and docs/ under the current directory, skipping dated design history in docs/superpowers/{plans,reviews,specs}/; name a path to check it.',
    flags: [
      { flag: '--exclude=<fragment>', desc: 'Skip files whose path contains this text (repeatable)' },
      { flag: '--json', desc: 'Print { files, checked, failures } as JSON' }
    ],
    examples: ['chemx docs check', 'chemx docs check AGENTS.md docs --exclude=docs/superpowers/']
  }
];
