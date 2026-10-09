// Command schema entries for host integration: Claude Code hooks, doctor and friction.
// Assembled in commands-schema.js. `group` and `brief` follow the grouped help layout.

export const HOST_COMMANDS = [
  {
    name: 'hook',
    aliases: ['hooks', 'install-hooks', 'setup-ci'],
    group: 'setup',
    brief: 'Run and install Claude/git hooks, CI',
    usage: 'chemx hook <claude-pre-tool|claude-post-edit|session-start|statusline> | chemx install-hooks --host=claude [--scope=project|local] [--dry-run] [--json]',
    summary: 'Claude Code hook handlers and their installer; without --host, install-hooks runs the git hook and CI wizard.',
    description: 'Hook handlers read the hook JSON on stdin and fail open. claude-pre-tool is the one guard: with a real shell tokenizer it denies raw runners, git diff/log/show, find, repo-source reads and searches, and shell writes into repo files (redirects, tee, sed -i, perl -i), naming the exact chemx call; it nudges (advice, no block) on git status/add/commit, hand-rolled waits and ls of repo dirs when this chemx has the replacement command; native Read/Edit/Write/Glob/Grep follow nativeFileTools. `# chemx-bypass: <reason>` allows a call, logs friction and, when a rule was overridden, a guard-bypass feed event. install-hooks --host=claude merges hooks and statusLine into the tracked .claude/settings.json (or the local file with --scope=local) idempotently, lists each added or replaced entry, backs up to .chemx/backups first, replaces only chemx-owned entries. By default it touches only that settings file (and .chemxrc with --native-file-tools); .mcp.json, the git pre-commit hook and the CI workflow change only with --write-mcp, --git-hooks and --pin-ci, and every file written is listed (--dry-run lists the same set). Claude Code may ask you to review changed hooks with /hooks before they apply. Docs: docs/hooks.md.',
    flags: [
      { flag: '--host=claude', desc: 'install-hooks: target host' },
      { flag: '--scope=project|local', desc: 'tracked .claude/settings.json (default) or the untracked settings.local.json' },
      { flag: '--native-file-tools=block|warn|allow', desc: 'Also record the native file tool policy in .chemxrc (strict JSON only)' },
      { flag: '--dry-run', desc: 'Print the plan; write nothing' },
      { flag: '--write-mcp', desc: 'Also write the chemical-x launch into .mcp.json (project-relative when the kit is inside the project, so it can be committed)' },
      { flag: '--no-statusline', desc: 'Leave statusLine alone' },
      { flag: '--git-hooks', desc: 'Also create or re-pin the git pre-commit hook (alias --git-hook); off by default' },
      { flag: '--pin-ci', desc: 'Also create or re-pin .github/workflows/chemx-audit.yml (alias --ci); off by default' },
      { flag: '--json', desc: 'Machine-readable report' }
    ],
    examples: [
      'chemx install-hooks --host=claude --dry-run',
      'chemx install-hooks --host=claude --native-file-tools=block',
      'echo \'{"tool_name":"Bash","tool_input":{"command":"git log"}}\' | chemx hook claude-pre-tool'
    ]
  },
  {
    name: 'doctor',
    aliases: [],
    group: 'setup',
    brief: 'Diagnose install, PATH, MCP and hooks',
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
    brief: 'Read guard denials and wrong calls',
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
