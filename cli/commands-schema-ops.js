// Command schema entries for the agents and setup groups. Assembled in commands-schema.js.
export const OPS_COMMANDS = [
  {
    name: 'mcp',
    aliases: ['server', 'mcp-server'],
    group: 'agents',
    brief: 'Start MCP server',
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
    brief: 'Register MCP server',
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
    brief: 'Tasks, locks, feed',
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
    brief: 'Session coordinator',
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
    brief: 'Add blueprints',
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
    brief: 'Scaffold a new app',
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
    brief: 'Pick pillars, shims',
    usage: 'chemx pillars [options]',
    summary: 'Configure architectural pillars and agent steering shims.',
    description: 'Writes host shims (CLAUDE.md, .cursorrules, llms.txt) that point at AGENTS.md. Seeds AGENTS.md if absent; never modifies it.',
    flags: [
      { flag: '--preset=<recommended|strict|minimal|none>', desc: 'Apply a predefined pillar preset' },
      { flag: '--write', desc: 'Write the files (default is a dry run)' },
      { flag: '--json', desc: 'Output configuration as JSON' }
    ],
    examples: ['chemx pillars', 'chemx pillars --preset=recommended --write']
  },
  {
    name: 'ui',
    aliases: ['dashboard', 'preview'],
    group: 'setup',
    brief: 'Web dashboard',
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
    brief: 'Onboarding HUD',
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
    brief: 'Repeats',
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
  }
];
