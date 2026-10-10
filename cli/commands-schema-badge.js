// Command schema entries for the verify group, second half (split from commands-schema-verify.js). Assembled in commands-schema.js.
export const VERIFY_MORE_COMMANDS = [
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
      { flag: '--triage', desc: 'File hazards as tasks in the shared team board (off unless --triage or .chemxrc autoTriage: true); at most 50 new tasks per run' },
      { flag: '--triage-all', desc: 'With --triage: no per-run cap on new tasks' },
      { flag: '--no-triage', desc: 'Never triage, even when .chemxrc sets autoTriage: true' },
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
    flags: [
      { flag: '--json', desc: 'Output snapshots as JSON' },
      { flag: '--limit=<n>', desc: 'Accepted by trend; whether the handler reads it is not traced' }
    ],
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
    flags: [
      { flag: '--grade=<A|B|C|D|F>', desc: 'Accepted by badge; its effect is not documented here' },
      { flag: '--label=<text>', desc: 'Accepted by badge; its effect is not documented here' },
      { flag: '--report-url=<url>', desc: 'Accepted by badge; its effect is not documented here' },
      { flag: '--discussion=<url>', desc: 'Accepted by badge; its effect is not documented here' },
      { flag: '--format=<fmt>', desc: 'Accepted by badge; its effect is not documented here' },
      { flag: '--copy', desc: 'Accepted by badge; its effect is not documented here' }
    ],
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
