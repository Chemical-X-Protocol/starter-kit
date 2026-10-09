// Command schema entries for the agents and setup groups. Assembled in commands-schema.js.
export const OPS_COMMANDS = [
  {
    name: 'mcp',
    aliases: ['server', 'mcp-server'],
    group: 'agents',
    brief: 'Start the MCP server (stdio)',
    usage: 'chemx mcp [options]',
    summary: 'Launch the Chemical X Model Context Protocol (MCP) stdio server.',
    description: 'Exposes the single `chemx` tool over JSON-RPC 2.0 on stdio.',
    flags: [
      { flag: '--install', desc: 'Register the MCP server in host client settings' },
      { flag: '--sync', desc: 'Sync Antigravity MCP tool schema definitions' }
    ],
    examples: ['chemx mcp', 'chemx mcp --sync']
  },
  {
    name: 'install-mcp',
    aliases: ['setup-mcp'],
    group: 'agents',
    brief: 'Register chemx in MCP client settings',
    usage: 'chemx install-mcp [options]',
    summary: 'Register the chemx MCP server in host client settings.',
    description: 'Writes the chemical-x server entry into supported MCP client configs.',
    flags: [],
    examples: ['chemx install-mcp']
  },
  {
    name: 'team',
    aliases: ['swarm', 'feed', 'tokens', 'telemetry', 'benchmark', 'ablation', 'memory'],
    group: 'agents',
    brief: 'Tasks, file locks, DMs and feed',
    usage: 'chemx team <status|task|lock|unlock|feed|post|inbox|dm|tokens|benchmark> [options]',
    summary: 'Multi-agent coordination layer backed by SQLite (.chemx/index.db).',
    description: 'Task queues, status transitions, AST verification on completion and file locks. `tokens` and `benchmark` are team subcommands. Run `chemx team task --help` for task detail.',
    flags: [
      { flag: '--as=<@handle>', desc: 'Agent identity handle (e.g. @claude)' },
      { flag: '--target=<path>', desc: 'Target file path for task AST verification' },
      { flag: '--no-target-confirm', desc: 'Complete a task that has no target file without verification' },
      { flag: '--force, -f', desc: 'Force complete task even if hazards remain' },
      { flag: '--tokens=<N>', desc: 'Prompt tokens consumed by task' },
      { flag: '--cost=<USD>', desc: 'Estimated dollar cost for task' },
      { flag: '--json', desc: 'Output data as JSON' }
    ],
    examples: [
      'chemx team task list',
      'chemx team task add "Implement dark mode toggle" --prio=1',
      'chemx team task claim 1 --as=@coder',
      'chemx team task done 1 --as=@coder'
    ]
  },
  {
    name: 'project',
    aliases: ['coordinator'],
    group: 'agents',
    brief: 'Coordinate a multi-step project session',
    usage: 'chemx project <init|status|...> [options]',
    summary: 'Coordinate a multi-step project session.',
    description: 'Starts and tracks a goal-driven project session in the index.',
    flags: [{ flag: '--json', desc: 'Output as JSON' }],
    examples: ['chemx project init "ship dark mode"', 'chemx project status']
  },
  {
    name: 'init',
    aliases: [],
    group: 'setup',
    brief: 'Unpack blueprints into an existing codebase',
    usage: 'chemx init [directory] [options]',
    summary: 'Unpack blueprints and molecular architecture drop-in files into an existing codebase.',
    description: 'Installs blueprints, domain hooks and foundation capsules (default: src/chemical-x).',
    flags: [{ flag: '--license=<key>', desc: 'Commercial license key for enterprise starter kit assets' }],
    examples: ['chemx init', 'chemx init src/chemical-x']
  },
  {
    name: 'create',
    aliases: ['scaffold'],
    group: 'setup',
    brief: 'Scaffold a complete new app',
    usage: 'npm create chemx [directory] [options]',
    summary: 'Scaffold a complete new Chemical X application.',
    description: 'Also available as `chemx create [directory]`.',
    flags: [
      { flag: '--framework=<id>', desc: 'Framework flavor: react (default), vue, svelte' },
      { flag: '--yes, -y', desc: 'Skip interactive prompts' },
      { flag: '--install', desc: 'Install dependencies after scaffolding' },
      { flag: '--headless', desc: 'Headless mode for CI and agents' }
    ],
    examples: ['npm create chemx my-app --framework=react', 'chemx create my-app --framework=svelte --install']
  },
  {
    name: 'pillars',
    aliases: ['config:pillars', 'rules'],
    group: 'setup',
    brief: 'Configure architecture pillars and shims',
    usage: 'chemx pillars [options]',
    summary: 'Configure architectural pillars and agent steering shims.',
    description: 'Writes host shims (CLAUDE.md, .cursorrules, llms.txt) that point at AGENTS.md. Seeds AGENTS.md if absent; otherwise leaves it alone. With --protocol or --protocol-only it also writes coordination-protocol rules for hosts without Claude Code hooks: GEMINI.md, .agent/rules/chemx-protocol.md, and a marked block in AGENTS.md and .cursorrules. Those hosts are told the steps; nothing blocks them if they ignore them.',
    flags: [
      { flag: '--preset=<recommended|strict|minimal|none>', desc: 'Apply a predefined pillar preset' },
      { flag: '--write', desc: 'Write the files (default is a dry run)' },
      { flag: '--protocol', desc: 'Also write the coordination protocol files, between chemx:protocol markers in AGENTS.md and .cursorrules' },
      { flag: '--protocol-only', desc: 'Write only the protocol files; config, CLAUDE.md and llms.txt are not touched' },
      { flag: '--json', desc: 'Output configuration as JSON' }
    ],
    examples: ['chemx pillars', 'chemx pillars --preset=recommended --write', 'chemx pillars --protocol-only --write']
  },
  {
    name: 'ui',
    aliases: ['dashboard', 'preview'],
    group: 'setup',
    brief: 'Start the web dashboard',
    usage: 'chemx ui [options]',
    summary: 'Launch the Chemical X web dashboard.',
    description: 'Kanban task boards, agent rails, SQLite studio and AST tree exploration.',
    flags: [
      { flag: '--port=<N>', desc: 'Server port (default: 4173)' },
      { flag: '--host=<addr>', desc: 'Bind address (default: 127.0.0.1). A non-loopback host exposes the UI beyond this machine and prints a warning.' }
    ],
    examples: ['chemx ui', 'chemx ui --port=3000']
  },
  {
    name: 'tesseract',
    aliases: ['cube', 'matrix'],
    group: 'setup',
    brief: 'Print the agent onboarding briefing',
    usage: 'chemx tesseract [options]',
    summary: 'Agent onboarding HUD: directives, topology and swarm telemetry.',
    description: 'Prints the operational directives and current project state.',
    flags: [{ flag: '--json', desc: 'Output the payload as JSON' }],
    examples: ['chemx tesseract', 'chemx tesseract --json']
  },
  {
    name: 'patterns',
    aliases: [],
    group: 'verify',
    brief: 'Find repeated code worth extracting',
    usage: 'chemx patterns [dir] [--type=<T>] [--min=<N>] [--full] [--score=<labels.json>]',
    summary: 'List repeated code patterns found by the audit (same handler as the MCP patterns action).',
    description: 'Prints compact JSON candidates with sample occurrences. Interim alias until the Forge surface lands.',
    flags: [
      { flag: '--type=<T>', desc: 'Only this pattern type (default: ALL)' },
      { flag: '--min=<N>', desc: 'Minimum file count (default: 2)' },
      { flag: '--full', desc: 'Include every occurrence instead of samples' },
      { flag: '--score=<labels.json>', desc: 'Score the detector against the content-anchored ground truth (cli/patterns/fixtures/gt/labels.json); add --json, --dir=<d>, --input=<groups.json>' }
    ],
    examples: ['chemx patterns', 'chemx patterns src --min=3']
  },
  {
    name: 'commit',
    aliases: [],
    group: 'wrappers',
    brief: 'Commit listed files under the coordination protocol',
    usage: 'chemx commit <files...> -m <subject> [-m <body>] [--task=<id> | --no-task=<reason>] [--release] [--json] [--as=@handle]',
    summary: 'Path-limited git commit that checks leases and the task id, then records the commit on the task.',
    description: 'Stages only the listed files and commits only them; the repository pre-commit hook always runs. Refuses -a/--all, --no-verify, an empty file list, other already-staged paths, a file under another handle\'s live lease, and a commit with neither a task id (#<id> in the message or --task) nor --no-task=<reason>. Adds [skip ci] when .chemxrc has commit.skipCi, and a Co-Authored-By trailer only when CHEMX_COAUTHOR or commit.coAuthor names one. Retries a held .git/index.lock up to 6 times over about 20 s. A failed gate leaves the listed files staged. Lease checks and the task event are best effort: a lease taken after the check is not seen, and an unavailable team db skips the event.',
    flags: [
      { flag: '-m <text>', desc: 'Subject (first) or body paragraph (repeatable)' },
      { flag: '--task=<id>', desc: 'Task the commit belongs to; added to the subject as (#<id>) when missing' },
      { flag: '--no-task=<reason>', desc: 'Commit without a task; the reason is recorded in the body and the feed' },
      { flag: '--release', desc: 'Release your own leases on the committed files after a successful commit' },
      { flag: '--as=@handle', desc: 'Committer handle (default: CHEMX_AGENT_ID, else a session handle)' },
      { flag: '--json', desc: 'Print the result as one object' }
    ],
    examples: ['chemx commit src/a.js src/b.js -m "fix(a): handle empty input (#42)"', 'chemx commit docs/x.md -m "docs: x" --task=42 --release', 'chemx commit notes.txt -m "chore: notes" --no-task="one-off cleanup"']
  }
];
