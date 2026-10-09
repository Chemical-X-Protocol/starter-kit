// Command schema entries for the shell wrappers group. Assembled in commands-schema.js.
export const WRAPPER_COMMANDS = [
  {
    name: 'diff',
    aliases: ['d'],
    group: 'wrappers',
    brief: 'git diff -U0, auto --stat',
    usage: 'chemx d [git diff args] [options]',
    summary: 'Zero-context git diff (-U0) that collapses to --stat past 80 lines.',
    description: 'Runs git diff -U0 --no-color. Micro-syncs dirty files to an existing .chemx/index.db.',
    flags: [
      { flag: '--stat', desc: 'Show the diff stat only' },
      { flag: '--full', desc: 'Never collapse to --stat' }
    ],
    examples: ['chemx d', 'chemx d --stat', 'chemx d HEAD~1 --full']
  },
  {
    name: 'log',
    aliases: [],
    group: 'wrappers',
    brief: 'git log --oneline',
    usage: 'chemx log [options]',
    summary: 'Compact single-line git commit history.',
    description: 'Runs git log --oneline with a commit limit.',
    flags: [{ flag: '-n <N>', desc: 'Number of commits to show (default: 10)' }],
    examples: ['chemx log', 'chemx log -n 5']
  },
  {
    name: 'pkg',
    aliases: ['p'],
    group: 'wrappers',
    brief: 'package.json scripts/deps',
    usage: 'chemx p [script|dep] [options]',
    summary: 'Token-minified package.json reader.',
    description: 'Extracts single scripts, dependencies, or keys from package.json.',
    flags: [
      { flag: '-s, --scripts', desc: 'List all scripts' },
      { flag: '-d, --deps', desc: 'List dependencies' }
    ],
    examples: ['chemx p -s', 'chemx p build', 'chemx p -d']
  },
  {
    name: 'ls',
    aliases: ['f'],
    group: 'wrappers',
    brief: 'Gitignore-aware file finder',
    usage: 'chemx f [substring]',
    summary: 'Gitignore-aware path finder.',
    description: 'Lists tracked and untracked files whose path contains the substring.',
    flags: [],
    examples: ['chemx f controller', 'chemx f .vue']
  },
  {
    name: 'json',
    aliases: ['j'],
    group: 'wrappers',
    brief: 'JSON shape peek',
    usage: 'chemx j <file.json>',
    summary: 'Structural JSON shape peeker.',
    description: 'Infers types, array element types and keys without dumping the payload.',
    flags: [],
    examples: ['chemx j package.json', 'chemx j tsconfig.json']
  },
  {
    name: 'batch',
    aliases: ['do'],
    group: 'wrappers',
    brief: 'Run commands in one process',
    usage: 'chemx do "<cmd1>" "<cmd2>" ...',
    summary: 'Sequential multi-command runner inside a single warm Node process.',
    description: 'Avoids repeated process startup for bursts of small commands.',
    flags: [],
    examples: ['chemx do "d" "p -s" "verify"']
  },
];
