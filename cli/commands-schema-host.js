// Command schema entries for host integration: Claude Code hooks, doctor and friction.
// Assembled in commands-schema.js. `group` and `brief` follow the grouped help layout.

export const HOST_COMMANDS = [
  {
    name: 'hook',
    aliases: ['hooks', 'install-hooks', 'setup-ci'],
    group: 'setup',
    brief: 'Claude hooks, git hook and CI',
    usage: 'chemx hook <claude-pre-tool|claude-post-edit|session-start|statusline> | chemx install-hooks --host=claude [--scope=local|project] [--dry-run] [--json]',
    summary: 'Claude Code hook handlers and their installer; without --host, install-hooks runs the git hook and CI wizard.',
    description: 'Hook handlers read the hook JSON on stdin and fail open. claude-pre-tool routes raw runners, git diff/log and repo source reads through chemx with a real shell tokenizer; `# chemx-bypass: <reason>` allows a call and logs friction. install-hooks --host=claude merges hooks, statusLine and the .mcp.json launch idempotently, backs up to .chemx/backups first, replaces only chemx-owned entries and re-pins an existing chemx pre-commit hook and CI workflow to the same chemx.',
    flags: [
      { flag: '--host=claude', desc: 'install-hooks: target host' },
      { flag: '--scope=local|project', desc: 'settings.local.json (default) or the shared settings.json' },
      { flag: '--dry-run', desc: 'Print the plan; write nothing' },
      { flag: '--no-mcp', desc: 'Leave .mcp.json alone' },
      { flag: '--no-statusline', desc: 'Leave statusLine alone' },
      { flag: '--git-hook', desc: 'Also create the pinned git pre-commit hook when missing' },
      { flag: '--ci', desc: 'Also create the pinned CI workflow when missing' },
      { flag: '--json', desc: 'Machine-readable report' }
    ],
    examples: [
      'chemx install-hooks --host=claude --dry-run',
      'chemx install-hooks --host=claude --scope=project',
      'echo \'{"tool_name":"Bash","tool_input":{"command":"git log"}}\' | chemx hook claude-pre-tool'
    ]
  },
  {
    name: 'doctor',
    aliases: [],
    group: 'setup',
    brief: 'Diagnose chemx install and MCP',
    usage: 'chemx doctor [--fix] [--json] [--root=<dir>]',
    summary: 'Diagnose how this machine runs chemx: PATH bins, MCP launch and running servers, index, hooks, shims, node.',
    description: 'Reports each check as ok, FAIL or ?? (inconclusive). Running MCP servers are read from /proc with their version, root and whether the kit code changed after they started. --fix repairs only hooks and the .mcp.json launch (idempotent, backed up); it never edits shims and never kills processes.',
    flags: [
      { flag: '--fix', desc: 'Repair hooks and the MCP launch via install-hooks' },
      { flag: '--json', desc: 'Machine-readable report' },
      { flag: '--root=<dir>', desc: 'Project root (default: git toplevel)' }
    ],
    examples: ['chemx doctor', 'chemx doctor --fix']
  },
  {
    name: 'friction',
    aliases: [],
    group: 'agents',
    brief: 'Friction log and usage report',
    usage: 'chemx friction [summary | add "<note>" | export --to=<file.md>] | --usage <transcript dir>',
    summary: 'Read back guard denials, bypasses and wrong calls; measure chemx adoption from agent transcripts.',
    description: 'Hooks append denials and `# chemx-bypass:` reasons to .chemx/friction.jsonl automatically; unknown chemx commands are captured too. export appends new entries (cursor-tracked) to a Markdown log. --usage reads Claude Code JSONL transcripts and counts chemx vs raw calls, bypass reasons, grep -r vs q, piped chemx output, MCP calls and guard denials.',
    flags: [
      { flag: '--usage', desc: 'Usage report from transcript files or directories' },
      { flag: '--to=<file.md>', desc: 'export target' },
      { flag: '--dry-run', desc: 'export: show what would be appended' },
      { flag: '--json', desc: 'Machine-readable output' }
    ],
    examples: [
      'chemx friction',
      'chemx friction export --to=docs/friction-log.md',
      'chemx friction --usage ~/.claude/projects/<project>/<session>/subagents'
    ]
  }
];
