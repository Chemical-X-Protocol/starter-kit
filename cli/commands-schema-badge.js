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
  },
  {
    name: 'changelog',
    aliases: [],
    group: 'verify',
    brief: 'Fold changelog fragments into CHANGELOG.md',
    usage: 'chemx changelog [--check] [--dry-run] [--json]',
    summary: 'Fold the fragments in docs/changelog.d/ into docs/CHANGELOG.md under Unreleased, then delete them.',
    description: 'Write one file per change, docs/changelog.d/<ticket-or-slug>.md, and never edit docs/CHANGELOG.md by hand: two tickets then never touch the same lines. A fragment\'s first line is its section heading (`### Fixed`, `### Added`, or a title with the ticket id), then the text; one section per fragment, no other #, ## or ### heading (use #### or bold). Fragments fold in file name order above the sections Unreleased already has; fragments with the same heading become one section, and a heading Unreleased already has gets the text at the end of that section. Every other line of CHANGELOG.md stays as it was. A malformed fragment (no heading, no text, a second heading, a stray non-.md file) or a CHANGELOG.md with no `## Unreleased` section refuses the whole fold: nothing is written and nothing is deleted. docs/changelog.d/README.md is not a fragment. Paths are relative to the current directory (use --root=<dir> for another project).',
    flags: [
      { flag: '--check', desc: 'Validate the fragments and that they would fold; change nothing; exit 1 on a problem' },
      { flag: '--dry-run', desc: 'Say what would be folded; write and delete nothing' },
      { flag: '--json', desc: 'Print { fragments, problems, sections, folded } as JSON' }
    ],
    examples: ['chemx changelog --check', 'chemx changelog --dry-run', 'chemx changelog']
  }
];
