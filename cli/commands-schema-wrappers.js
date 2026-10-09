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
    usage: 'chemx f [pattern]',
    summary: 'Gitignore-aware path finder, submodules included.',
    description: 'Lists tracked and untracked-but-not-ignored files (git ls-files --recurse-submodules). A pattern with * or ? is a glob (basename unless it contains /, ** spans directories); otherwise a case-insensitive substring. No match exits 1 with a message.',
    flags: [],
    examples: ['chemx f "*.vue"', 'chemx f controller']
  },
  {
    name: 'json',
    aliases: ['j'],
    group: 'wrappers',
    brief: 'JSON shape peek',
    usage: 'chemx j <file.json>',
    summary: 'JSON peeker: small files verbatim, large ones as shape with values.',
    description: 'Files up to 2 KB are printed verbatim. Larger files print their key structure with scalar values kept (long strings truncated) and containers summarised past depth 3. Missing or invalid files exit 1.',
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
    description: 'Runs several chemx commands in one process. Every item runs even if an earlier one fails or calls exit; the batch exits with the worst item status (fail 1 > inconclusive 3 > pass 0) and prints a summary line.',
    flags: [],
    examples: ['chemx do "d" "p -s" "verify"']
  },
];
