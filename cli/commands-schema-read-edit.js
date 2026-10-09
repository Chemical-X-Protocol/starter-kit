// Command schema entries for the search, edit groups. Assembled in commands-schema.js.
import { describeLineBudgetPolicy } from './config/profiles.js';

export const READ_EDIT_COMMANDS = [
  {
    name: 'search',
    aliases: ['q', 'query', 'find'],
    group: 'search',
    brief: 'AST and literal code search',
    usage: 'chemx q <query|symbol|file> [options]',
    summary: 'Architecture-aware AST codebase query engine powered by SQLite (.chemx/index.db).',
    description: 'Indexes component tiers, exported symbols, props and hooks. Subcommands: refs <symbol>, deps <symbol|file>, context <target>.',
    flags: [
      { flag: '--json', desc: 'Minified JSON format for LLM agents' },
      { flag: '--columnar', desc: 'Token-compact columnar format (cols/rows) for agent pipelines' },
      { flag: '-i, --inspect', desc: 'Inspect props and hooks without full source' },
      { flag: '--tier=<tier>', desc: 'Filter by tier: atom, molecule, organism, hook, view' },
      { flag: '--blast-radius', desc: 'Map direct consumers, transitive dependents and impacted tiers (aliases: --blast, --impact)' },
      { flag: '--trace', desc: 'Forward call trace: downstream functions invoked by target' },
      { flag: '--backtrace', desc: 'Reverse backtrace: upstream callers leading to target' },
      { flag: '--max-depth=<N>', desc: 'Max depth for blast radius / trace traversal (default: 5)' },
      { flag: '--semantic', desc: 'Concept search via vector cosine similarity' },
      { flag: '--hybrid', desc: 'Blended BM25 keyword and vector RRF ranking' },
      { flag: '--hazards', desc: 'Query architectural rule violations (with --rule=<id>, --critical)' },
      { flag: '--pack', desc: 'Assemble a token-packed context bundle for a target symbol or file' },
      { flag: '-g, --literal', desc: 'Literal substring search with 60-character line clamping' },
      { flag: '-l, --lines', desc: 'Line-only output (path:line)' },
      { flag: '--failing, --clean', desc: 'Filter capsules by architectural health status' },
      { flag: '--reindex', desc: 'Force re-index before running query' }
    ],
    examples: [
      'chemx q "badge"',
      'chemx q -g "useTheme" -l',
      'chemx q a-button --blast-radius --json',
      'chemx q handleAction --backtrace',
      'chemx q "card" --tier=molecule'
    ]
  },
  {
    name: 'read',
    aliases: ['view', 'r'],
    group: 'search',
    brief: 'Outline, symbol or line range',
    usage: 'chemx read <file> [options]',
    summary: 'Token-minified file reader with AST outline and logic extraction.',
    description: 'Extracts structural outlines, logic skeletons, line ranges, or targeted symbol declarations.',
    flags: [
      { flag: '--outline, -o', desc: 'Signatures only' },
      { flag: '--logic, -l', desc: 'AST logic skeleton: control flow, guards and mutations' },
      { flag: '--template, -t', desc: 'Extract template markup only (Vue/Svelte/JSX)' },
      { flag: '--enrich', desc: 'Append a compacted logic skeleton after the outline' },
      { flag: '--trace=<name>', desc: 'Append forward call trace card inline (requires --enrich)' },
      { flag: '--backtrace=<name>', desc: 'Append reverse caller chain card inline (requires --enrich)' },
      { flag: '--symbol=<name>, -s', desc: 'Target a specific symbol definition' },
      { flag: '--connections', desc: 'Include caller graph and dependent references alongside symbol' },
      { flag: '--strip-comments', desc: 'Remove all code comments' },
      { flag: '--compact', desc: 'Remove blank lines and indentation' },
      { flag: '--start=<N>', desc: 'Starting line number (1-indexed)' },
      { flag: '--end=<N>', desc: 'Ending line number (1-indexed)' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: [
      'chemx read src/store.ts --outline',
      'chemx read src/controller.ts --logic',
      'chemx read api.ts --symbol=login',
      'chemx read src/router.ts --start=120 --end=160'
    ]
  },
  {
    name: 'trace',
    aliases: [],
    group: 'search',
    brief: 'Downstream call tree',
    usage: 'chemx trace <symbol> [options]',
    summary: 'Forward call trace: inspects downstream function invocations.',
    description: 'Maps the functions, services and external APIs called by the target symbol.',
    flags: [
      { flag: '--max-depth=<N>', desc: 'Max depth for call trace traversal (default: 3)' },
      { flag: '--json', desc: 'Output call tree as minified JSON' }
    ],
    examples: ['chemx trace useCartController', 'chemx trace handleCheckout --json']
  },
  {
    name: 'backtrace',
    aliases: [],
    group: 'search',
    brief: 'Upstream caller chains',
    usage: 'chemx backtrace <symbol> [options]',
    summary: 'Reverse call backtrace: maps upstream caller chains leading to target.',
    description: 'Traces how components, views and handlers reach the target symbol.',
    flags: [
      { flag: '--max-depth=<N>', desc: 'Max depth for backtrace traversal (default: 5)' },
      { flag: '--json', desc: 'Output causal path as minified JSON' }
    ],
    examples: ['chemx backtrace handleCheckout', 'chemx backtrace postOrder --json']
  },
  {
    name: 'check',
    aliases: [],
    group: 'search',
    brief: 'Audit one file',
    usage: 'chemx check <file> [options]',
    summary: 'Verify a single file or capsule against the architectural rules.',
    description: 'Runs the AST rules on one file and reports its hazards.',
    flags: [{ flag: '--json', desc: 'Output hazards as JSON' }],
    examples: ['chemx check src/components/m-card/m-card.vue']
  },
  {
    name: 'patch',
    aliases: ['edit'],
    group: 'edit',
    brief: 'Exact search/replace edit',
    usage: 'chemx patch <file> --target="<old>" --replacement="<new>" [options]',
    summary: 'Surgically patch a target file using exact search and replacement blocks.',
    description: 'Replaces targeted text blocks, then re-indexes and audits the file.',
    flags: [
      { flag: '--target="<old>"', desc: 'Exact text block to replace' },
      { flag: '--replacement="<new>"', desc: 'New replacement content' },
      { flag: '--multiple', desc: 'Allow replacing multiple occurrences' },
      { flag: '--dry-run', desc: 'Preview patch without writing to disk' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: [
      'chemx patch src/api.ts --target="v1" --replacement="v2"',
      'chemx patch src/App.tsx --target="oldCode" --replacement="newCode" --dry-run'
    ]
  },
  {
    name: 'write',
    aliases: [],
    group: 'edit',
    brief: 'Write a whole file',
    usage: 'chemx write <file> --content="<text>" [options]',
    summary: 'Write a file, then re-index and audit it.',
    description: 'Creates or replaces one file inside the project root.',
    flags: [
      { flag: '--content="<text>"', desc: 'File content to write' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: ['chemx write src/keep.ts --content="export const keep = true;\\n"']
  },
  {
    name: 'add',
    aliases: ['add:prop', 'add:state', 'add:action', 'fix'],
    group: 'edit',
    brief: 'Add a prop, state or action',
    usage: 'chemx add:<prop|state|action> <capsule-path> <name>:<type>',
    summary: 'Mutate a capsule by adding a prop, state field or action.',
    description: '`chemx add <tier> <name>` without prop/state/action runs the generate wizard.',
    flags: [{ flag: '--dry-run', desc: 'Preview the mutation without writing' }],
    examples: ['chemx add:prop src/m-card count:number', 'chemx add state src/m-card isOpen:boolean']
  },
  {
    name: 'explode',
    aliases: ['unpack'],
    group: 'edit',
    brief: 'Split a file into a capsule',
    usage: 'chemx explode <file-path> [options]',
    summary: 'Unpack a monolithic file into a capsule directory.',
    description: 'Moves top-level declarations into capsule files.',
    flags: [
      { flag: '--dry-run', desc: 'Preview the capsule plan without writing' },
      { flag: '--json', desc: 'Output the plan as JSON' }
    ],
    examples: ['chemx explode src/big-file.ts --dry-run']
  },
  {
    name: 'generate',
    aliases: ['g', 'gen', 'capsule', 'jig'],
    group: 'edit',
    brief: 'Scaffold a capsule',
    usage: 'chemx generate [tier] <name> [options]',
    summary: 'Scaffold a molecular capsule.',
    description: `Generates a capsule with co-located controller, types, styles and specs. ${describeLineBudgetPolicy()} Names starting with m-, a-, o-, t-, use- or v- also run this command.`,
    flags: [
      { flag: '--desc="<text>"', desc: 'Describe functionality to tailor archetype and state' },
      { flag: '--dry-run', desc: 'Preview planned files and lines without touching disk' },
      { flag: '--tier=<tier>', desc: 'Specify tier: atom, molecule, organism, hook, view' },
      { flag: '--framework=<id>', desc: 'Framework flavor: react, vue, svelte' },
      { flag: '--lean', desc: 'Generate minimal capsule without controller/spec' },
      { flag: '--json', desc: 'Output the plan as JSON' }
    ],
    examples: [
      'chemx generate m-task-list --framework=react',
      'chemx generate m-task-list --desc="add, toggle, remove items"',
      'chemx generate m-task-list --dry-run'
    ]
  }
];
