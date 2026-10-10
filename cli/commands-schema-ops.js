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
      { flag: '--sync', desc: 'Sync Antigravity MCP tool schema definitions' },
      { flag: '--global', desc: 'Also register in the home-directory client configs' },
      { flag: '--antigravity', desc: 'Same as --global (Antigravity host config)' }
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
    flags: [
      { flag: '--global', desc: 'Also register in the home-directory client configs' },
      { flag: '--antigravity', desc: 'Same as --global (Antigravity host config)' }
    ],
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
    flags: [
      { flag: '--license=<key>', desc: 'Commercial license key for enterprise starter kit assets' },
      { flag: '--yes, -y', desc: 'Skip interactive prompts' },
      { flag: '--headless', desc: 'Headless mode for CI and agents' },
      { flag: '--ci', desc: 'Same as --headless' },
      { flag: '--non-interactive', desc: 'Same as --headless' },
      { flag: '--no-interactive', desc: 'Same as --headless' },
      { flag: '--framework=<id>', desc: 'Framework flavor: react, vue, svelte' },
      { flag: '--install', desc: 'Install dependencies after unpacking' }
    ],
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
      { flag: '--headless', desc: 'Headless mode for CI and agents' },
      { flag: '--ci', desc: 'Same as --headless' },
      { flag: '--non-interactive', desc: 'Same as --headless' },
      { flag: '--no-interactive', desc: 'Same as --headless' },
      { flag: '--preset=<name>', desc: 'Apply a named preset' }
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
      { flag: '--yes, -y', desc: 'Skip prompts' },
      { flag: '--force', desc: 'Overwrite hand-authored files (a backup is written first)' },
      { flag: '--preset=<recommended|strict|minimal|none>', desc: 'Apply a predefined pillar preset' },
      { flag: '--write', desc: 'Write the files (default is a dry run)' },
      { flag: '--protocol', desc: 'Also write the coordination protocol files, between chemx:protocol markers in AGENTS.md and .cursorrules' },
      { flag: '--protocol-only', desc: 'Write only the protocol files; config, CLAUDE.md and llms.txt are not touched' },
      { flag: '--json', desc: 'Output configuration as JSON' }
    ],
    examples: ['chemx pillars', 'chemx pillars --preset=recommended --write', 'chemx pillars --protocol-only --write']
  }
];
