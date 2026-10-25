// Command schema entries for the agents group (the setup group lives in commands-schema-setup.js). Assembled in commands-schema.js.
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
    aliases: ['swarm', 'feed', 'tokens', 'telemetry', 'benchmark', 'ablation', 'memory', 'task'],
    group: 'agents',
    brief: 'Tasks, file locks, DMs and feed',
    usage: 'chemx team <status|task|brief|lock|unlock|feed|post|inbox|dm|tokens|benchmark> [options]',
    summary: 'Multi-agent coordination layer backed by SQLite (.chemx/index.db).',
    description: 'Task queues, status transitions, AST verification on completion and file locks. `tokens` and `benchmark` are team subcommands. `chemx task <action>` is the same as `chemx team task <action>`; run `chemx team task --help` (or `chemx task show --help`) for task detail. `chemx team brief <id>` stores or prints a task\'s long brief. An option with a value takes it after a space or an equals sign (`--prio 2`, `--prio=2`).',
    flags: [
      { flag: '--as=<@handle>', desc: 'Agent identity handle (e.g. @claude)' },
      { flag: '--target=<path>', desc: 'Target file path for task AST verification' },
      { flag: '--no-target-confirm', desc: 'Complete a task that has no target file without verification' },
      { flag: '--force, -f', desc: 'Force complete task even if hazards remain' },
      { flag: '--tokens=<N>', desc: 'Prompt tokens consumed by task' },
      { flag: '--cost=<USD>', desc: 'Estimated dollar cost for task' },
      { flag: '--epic=<id>', desc: 'tokens: tokens, cost and wall time over an epic\'s children, recursively (see docs/team-tokens.md)' },
      { flag: '--from=<@handle|file>', desc: 'feed: only events authored by this handle; task add: a .json/.yaml file of task rows (--from=- reads stdin)' },
      { flag: '--dry-run', desc: 'task add --from: check the file and print what would be added, write nothing' },
      { flag: '--kind=<task|decision|epic>', desc: 'task add: the kind of task (default task); decision and epic finish without a target file' },
      { flag: '--search=<text>', desc: 'task list: tasks whose title or description contains the text (any case, every status)' },
      { flag: '--titles', desc: 'task list: one line per task, id, status and title only' },
      { flag: '--file=<path>', desc: 'brief: store the file as the task\'s brief' },
      { flag: '--stdin', desc: 'brief: store standard input as the task\'s brief' },
      { flag: '--clear', desc: 'brief: remove the task\'s brief' },
      { flag: '--type=<lock|status|post|task>', desc: 'feed: an event-type group (or an exact event type, comma-separated)' },
      { flag: '--since=<id>', desc: 'feed: only events after this event id' },
      { flag: '--full', desc: 'feed: whole messages (default: the newest 20, one line each); task show: also the brief' },
      { flag: '--brief', desc: 'task show: header facts and only the comments after the description' },
      { flag: '--mine', desc: 'status: only your open tasks, leases and own events' },
      { flag: '--blockers', desc: 'status: also list the blocked tasks' },
      { flag: '--json', desc: 'Output data as JSON' }
    ],
    examples: [
      'chemx team task list',
      'chemx team task add "Implement dark mode toggle" --prio=1',
      'chemx team task claim 1 --as=@coder',
      'chemx team task show 12 --brief',
      'chemx task add --from tasks.yaml --dry-run',
      'chemx task list --search "test runner" --titles',
      'chemx team brief 12 --file design.md',
      'chemx team lock src/a.js src/b.js --as=@coder',
      'chemx team task done 1 --as=@coder',
      'chemx team feed --from=@coder --type=lock',
      'chemx team status --mine'
    ]
  },
  {
    name: 'run',
    aliases: [],
    group: 'agents',
    brief: 'Run a command, keeping your file leases alive',
    usage: 'chemx run [--as=@handle] -- <command> [args...]',
    summary: 'Run a command with your own terminal and renew your file leases every minute while it runs.',
    description: 'For anything long that is not a chemx call (a plugin test runner, a build script): a lease lapses 5 minutes after your last chemx call, and while this runs it is renewed every 60 seconds, from any directory (a git worktree included) once you have claimed a task. stdin, stdout and stderr are yours, untouched. The exit code is the command\'s (a signal is 128 + n); 127 = not found, 126 = cannot run, 125 = chemx run misused. SIGINT, SIGTERM and SIGHUP are passed to the command. One quoted word with spaces is a whole shell command. Without a handle (--as or CHEMX_AGENT_ID) nothing is renewed and stderr says so. Not for chemx\'s own long commands: test, verify, typecheck, build and audit already renew while they run.',
    flags: [{ flag: '--as=<@handle>', desc: 'Whose leases to renew (default: CHEMX_AGENT_ID)' }],
    examples: ['chemx run -- node tests/run-tests.mjs', 'chemx run --as=@sonnet-k13 -- docker exec u-wordpress php tests/suite.php']
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
  }
];
