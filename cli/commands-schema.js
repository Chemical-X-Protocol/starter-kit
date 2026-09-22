/**
 * Chemical X Protocol: Canonical Command Schema
 * Single source of truth for CLI commands, aliases, flags, descriptions, and examples.
 */

export const COMMANDS_SCHEMA = [
  {
    name: 'search',
    aliases: ['q', 'query', 'find'],
    usage: 'npx chemx search [query] [options]',
    summary: 'Architecture-aware AST codebase query engine powered by SQLite (.chemx/index.db).',
    description: 'Instantly indexes component tiers (atom/molecule/organism), exported symbols, props, and hooks. Designed for AI agents to replace token-heavy grep/cat scans.',
    flags: [
      { flag: '--json', desc: 'Minified JSON format for LLM agents' },
      { flag: '--columnar', desc: 'Token-compact columnar format (cols/rows) for agent pipelines' },
      { flag: '-i, --inspect', desc: 'Inspect props and hooks without full source' },
      { flag: '--tier=<tier>', desc: 'Filter by tier: atom, molecule, organism, hook, view' },
      { flag: '--blast-radius', desc: 'Map direct consumers, transitive dependents & impacted tiers (aliases: --blast, --impact)' },
      { flag: '--max-depth=<N>', desc: 'Max depth for blast radius traversal (default: 5)' },
      { flag: '--semantic', desc: 'Concept search via vector cosine similarity' },
      { flag: '--hybrid', desc: 'Blended BM25 keyword + Vector RRF ranking' },
      { flag: '--hazards', desc: 'Query architectural rule violations directly (flags: --rule=<id>, --critical)' },
      { flag: '--pack', desc: 'Assemble token-packed context bundle for target symbol or file' },
      { flag: '--reindex', desc: 'Force re-index before running query' }
    ],
    examples: [
      'npx chemx search "badge"',
      'pnpm q a-button --blast-radius --json',
      'pnpm q "button click handler" --semantic',
      'pnpm q "useAttentionCardController" --hybrid --json',
      'pnpm q "useTheme" --inspect',
      'npx chemx search "card" --tier=molecule'
    ]
  },
  {
    name: 'read',
    aliases: ['view'],
    usage: 'npx chemx read <file> [options]',
    summary: 'Token-minified file reader with AST outline extraction.',
    description: 'Extracts structural AST outlines, stripped comments, line ranges, or targeted symbol declarations to minimize LLM context token consumption.',
    flags: [
      { flag: '--outline', desc: 'Signatures only (80%+ token savings)' },
      { flag: '--symbol=<name>', desc: 'Target a specific symbol definition' },
      { flag: '--connections', desc: 'Include caller graph and dependent references alongside symbol' },
      { flag: '--strip-comments', desc: 'Remove all code comments' },
      { flag: '--compact', desc: 'Remove blank lines and indentation' },
      { flag: '--start=<N>', desc: 'Starting line number' },
      { flag: '--end=<N>', desc: 'Ending line number' },
      { flag: '--json', desc: 'Output metadata as JSON' }
    ],
    examples: [
      'npx chemx read src/store.ts --outline',
      'npx chemx read api.ts --symbol=login --connections',
      'npx chemx read src/ui/atoms/a-button/types.d.ts --symbol=ButtonVariant'
    ]
  },
  {
    name: 'patch',
    aliases: ['edit'],
    usage: 'npx chemx patch <file> [options]',
    summary: 'Surgically patch a target file using exact search and replacement blocks.',
    description: 'Replaces targeted text blocks with automatic SQLite micro-indexing and architectural line budget verification.',
    flags: [
      { flag: '--target="<old>"', desc: 'Exact text block to replace' },
      { flag: '--replacement="<new>"', desc: 'New replacement content' },
      { flag: '--multiple', desc: 'Allow replacing multiple occurrences' },
      { flag: '--dry-run', desc: 'Preview patch without writing to disk' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: [
      'npx chemx patch src/api.ts --target="v1" --replacement="v2"',
      'npx chemx patch src/App.tsx --target="oldCode" --replacement="newCode" --dry-run'
    ]
  },
  {
    name: 'mcp',
    aliases: ['server', 'mcp-server'],
    usage: 'npx chemx mcp [options]',
    summary: 'Launch the native Chemical X Model Context Protocol (MCP) Stdio server.',
    description: 'Exposes token-minified tools (chemx_q, chemx_read, chemx_patch, chemx_audit, chemx_team_task) over JSON-RPC 2.0 stdio transport.',
    flags: [
      { flag: '--install', desc: 'Install and register MCP server in host client settings' },
      { flag: '--sync', desc: 'Sync Antigravity MCP tool schema definitions and instructions' }
    ],
    examples: [
      'npx chemx mcp',
      'pnpm chemx:mcp',
      'npx chemx mcp --sync'
    ]
  },
  {
    name: 'build',
    aliases: ['run', 'wrap'],
    usage: 'npx chemx build [options] [-- <command>]',
    summary: 'Wrap and audit build scripts with token-conserving silent execution.',
    description: 'Suppresses multi-thousand-line compiler noise, catalogs diagnostics into grouped categories, and provides actionable hints for AI agents.',
    flags: [
      { flag: '--json', desc: 'Minified JSON format with categorised diagnostics' },
      { flag: '--command="<cmd>"', desc: 'Explicit build command (default: npm run build)' }
    ],
    examples: [
      'npx chemx build',
      'npx chemx build -- vite build'
    ]
  },
  {
    name: 'audit',
    aliases: [],
    usage: 'npx chemx audit [directory] [options]',
    summary: 'Execute full architectural AST audit on codebase.',
    description: 'Validates line budgets, molecular separation, zero-raw-DOM rules, and populates SQLite index tables.',
    flags: [
      { flag: '--triage', desc: 'Auto-convert unassigned hazards into team tasks' },
      { flag: '--strict', desc: 'Fail on any architectural hazard' },
      { flag: '--json', desc: 'Output structured audit report as JSON' },
      { flag: '--markdown', desc: 'Generate Markdown audit report' },
      { flag: '--min-grade=<A|B|C|D|F>', desc: 'Minimum acceptable architectural grade' }
    ],
    examples: [
      'npx chemx audit',
      'npx chemx audit --triage',
      'npx chemx audit --strict --min-grade=A'
    ]
  },
  {
    name: 'generate',
    aliases: ['g', 'gen', 'capsule'],
    usage: 'npx chemx generate [tier] <name> [options]',
    summary: 'Scaffold crystalline molecular capsules under 100 lines.',
    description: 'Generates self-contained component capsules with co-located controllers, granular domain types, styles, and specs.',
    flags: [
      { flag: '--desc="<text>"', desc: 'Describe functionality to tailor archetype and state' },
      { flag: '--dry-run', desc: 'Preview planned files and lines without touching disk' },
      { flag: '--tier=<tier>', desc: 'Specify tier: atom, molecule, organism, hook, view' },
      { flag: '--framework=<id>', desc: 'Framework flavor: react, vue, svelte' },
      { flag: '--lean', desc: 'Generate minimal capsule without controller/spec' }
    ],
    examples: [
      'npx chemx generate m-task-list --framework=react',
      'npx chemx generate m-task-list --desc="add, toggle, remove items"',
      'npx chemx generate m-task-list --dry-run'
    ]
  },
  {
    name: 'team',
    aliases: ['swarm', 'feed'],
    usage: 'npx chemx team <status|feed|task|lock|post> [options]',
    summary: 'Multi-agent coordination layer backed by SQLite (.chemx/index.db).',
    description: 'Manages autonomous agent task queues, status transitions, AST verification on completion, and file locks.',
    flags: [
      { flag: '--as=<@handle>', desc: 'Agent identity handle (e.g. @claude, @antigravity)' },
      { flag: '--target=<path>', desc: 'Target file path for task AST verification' },
      { flag: '--no-target-confirm', desc: 'Confirm completing a task that has no target file without verification' },
      { flag: '--force, -f', desc: 'Force complete task even if hazards remain' },
      { flag: '--tokens=<N>', desc: 'Prompt tokens consumed by task' },
      { flag: '--cost=<USD>', desc: 'Estimated dollar cost for task' },
      { flag: '--json', desc: 'Output data as JSON' }
    ],
    examples: [
      'npx chemx team task list',
      'npx chemx team task triage',
      'npx chemx team task add "Implement dark mode toggle" --prio=1',
      'npx chemx team task claim 1 --as=@coder',
      'npx chemx team task done 1 --as=@coder --force'
    ]
  },
  {
    name: 'verify',
    aliases: ['check:all'],
    usage: 'npx chemx verify [options]',
    summary: 'Runs full verification pipeline: AST audit, TypeScript typecheck, and test suite.',
    description: 'Compact single-card verification returning token-efficient output for AI agents (~45 tokens when green).',
    flags: [
      { flag: '--json', desc: 'Minified JSON format' }
    ],
    examples: [
      'npx chemx verify',
      'pnpm chemx verify --json'
    ]
  },
  {
    name: 'pillars',
    aliases: ['config:pillars', 'rules'],
    usage: 'npx chemx pillars [options]',
    summary: 'Interactive wizard to configure architectural pillars and agent steering directives.',
    description: 'Customize which pillars and directives (AGENTS.md, .cursorrules) are installed in your codebase.',
    flags: [
      { flag: '--preset=<recommended|strict|minimal|none>', desc: 'Apply a predefined pillar configuration preset' },
      { flag: '--dry-run', desc: 'Preview pillar configuration without writing files' },
      { flag: '--json', desc: 'Output configuration as JSON' }
    ],
    examples: [
      'npx chemx pillars',
      'npx chemx pillars --preset=recommended',
      'npx chemx pillars --preset=minimal --dry-run'
    ]
  },
  {
    name: 'ui',
    aliases: ['dashboard', 'preview'],
    usage: 'npx chemx ui [options]',
    summary: 'Launch the Chemical X interactive web dashboard.',
    description: 'Provides real-time Kanban task boards, agent rails, live SQLite Database Studio, and codebase AST tree exploration.',
    flags: [
      { flag: '--port=<N>', desc: 'Server port (default: 4173)' }
    ],
    examples: [
      'npx chemx ui',
      'npx chemx dashboard --port=3000'
    ]
  }
];
