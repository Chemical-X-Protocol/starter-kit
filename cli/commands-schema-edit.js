// Command schema entries for the edit group. Assembled in commands-schema.js.
import { describeLineBudgetPolicy } from './config/profiles.js';

export const EDIT_COMMANDS = [
  {
    name: 'patch',
    aliases: ['edit'],
    group: 'edit',
    brief: 'Replace exact text in a file',
    usage: "chemx patch <file> [options] <<'EOF' (SEARCH/REPLACE blocks on stdin)",
    summary: 'Surgically patch a target file using exact search and replacement blocks.',
    description: 'Reads one or more SEARCH/REPLACE blocks from a heredoc (all-or-nothing), or one --target/--replacement pair; then re-indexes and audits the file.',
    flags: [
      { flag: '<<\'EOF\' ... EOF', desc: 'Blocks: "<<<<<<< SEARCH", old lines, "=======", new lines, ">>>>>>> REPLACE"' },
      { flag: '--target="<old>"', desc: 'Exact text block to replace' },
      { flag: '--replacement="<new>"', desc: 'New replacement content' },
      { flag: '--replace', desc: 'Alias of --replacement' },
      { flag: '--target-file=<path>', desc: 'Read the exact text block to replace from a file' },
      { flag: '--replacement-file=<path>', desc: 'Read the replacement content from a file' },
      { flag: '--allow-remove=<a,b>', desc: 'Top-level declarations the patch may remove' },
      { flag: '--multiple, --allow-multiple', desc: 'Allow replacing multiple occurrences' },
      { flag: '--dry-run', desc: 'Preview patch without writing to disk' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: [
      "chemx patch src/api.ts <<'EOF'\n<<<<<<< SEARCH\nconst v = 1;\n=======\nconst v = 2;\n>>>>>>> REPLACE\nEOF",
      'chemx patch src/api.ts --target="v1" --replacement="v2"',
      'chemx patch src/App.tsx --target="oldCode" --replacement="newCode" --dry-run'
    ]
  },
  {
    name: 'write',
    aliases: [],
    group: 'edit',
    brief: 'Write a whole file, then re-index it',
    usage: "chemx write <file> - [options] <<'EOF' (content on stdin)",
    summary: 'Write a file, then re-index and audit it.',
    description: 'Creates (or with --overwrite replaces) one file inside the project root.',
    flags: [
      { flag: '-, --stdin', desc: 'Read the whole content from stdin (heredoc)' },
      { flag: '--content="<text>"', desc: 'File content to write' },
      { flag: '--content-file=<path>', desc: 'Read the file content from a file' },
      { flag: '--allow-remove=<a,b>', desc: 'Top-level declarations an overwrite may remove' },
      { flag: '--overwrite', desc: 'Allow replacing an existing file' },
      { flag: '--append', desc: 'Add the content to the end of the file (created if missing), with the same parse check, audit, index sync and lock checks; refused with --overwrite; no newline is inserted for you' },
      { flag: '--json', desc: 'Output result as minified JSON' }
    ],
    examples: ["chemx write src/keep.ts - <<'EOF'\nexport const keep = true;\nEOF", 'chemx write src/keep.ts --content="export const keep = true;\\n"']
  },
  {
    name: 'add',
    aliases: ['add:prop', 'add:state', 'add:action', 'fix'],
    group: 'edit',
    brief: 'Add a prop, state or action to a capsule',
    usage: 'chemx add:<prop|state|action> <capsule-path> <name>:<type>',
    summary: 'Mutate a capsule by adding a prop, state field or action.',
    description: '`chemx add <tier> <name>` without prop/state/action runs the generate wizard.',
    flags: [
      { flag: '--dry-run', desc: 'Preview the mutation without writing' },
      { flag: '--json', desc: 'Output the result as JSON (chemx fix)' }
    ],
    examples: ['chemx add:prop src/m-card count:number', 'chemx add state src/m-card isOpen:boolean']
  },
  {
    name: 'explode',
    aliases: ['unpack'],
    group: 'edit',
    brief: 'Split a large file into a capsule',
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
    brief: 'Scaffold a new capsule',
    usage: 'chemx generate [tier] <name> [options]',
    summary: 'Scaffold a molecular capsule.',
    description: `Generates a capsule with co-located controller, types, styles and specs. ${describeLineBudgetPolicy()} Names starting with m-, a-, o-, t-, use- or v- also run this command.`,
    flags: [
      { flag: '--desc="<text>"', desc: 'Describe functionality to tailor archetype and state' },
      { flag: '--dry-run', desc: 'Preview planned files and lines without touching disk' },
      { flag: '--tier=<tier>', desc: 'Specify tier: atom, molecule, organism, hook, view' },
      { flag: '--framework=<id>', desc: 'Framework flavor: react, vue, svelte' },
      { flag: '--lean', desc: 'Generate minimal capsule without controller/spec' },
      { flag: '--yes, -y', desc: 'Skip interactive prompts' },
      { flag: '--preset=<name>', desc: 'Apply a named preset (read by the jig generator)' },
      { flag: '--jig=<kind>', desc: 'Generate a non-UI file of this kind with the jig generator' },
      { flag: '--kind=<kind>', desc: 'Same as --jig=<kind>' },
      { flag: '--json', desc: 'Output the plan as JSON' }
    ],
    examples: [
      'chemx generate m-task-list --framework=react',
      'chemx generate m-task-list --desc="add, toggle, remove items"',
      'chemx generate m-task-list --dry-run'
    ]
  }
];
