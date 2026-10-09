// Command schema entries for the shell wrappers group. Assembled in commands-schema.js.
export const WRAPPER_COMMANDS = [
  {
    name: 'diff',
    aliases: ['d'],
    group: 'wrappers',
    brief: 'git diff, summarized when long',
    usage: 'chemx d [git diff args] [options]',
    summary: 'Zero-context git diff (-U0) that collapses to --stat past 80 lines.',
    description: 'Runs git diff -U0 --no-color. Micro-syncs dirty files to an existing .chemx/index.db.',
    flags: [
      { flag: '--stat', desc: 'Show the diff stat only' },
      { flag: '--full', desc: 'Never collapse to --stat' },
      { flag: '--conflicts', desc: 'Combined diff of unmerged files only (works mid-merge, even of chemx itself)' }
    ],
    examples: ['chemx d', 'chemx d --stat', 'chemx d HEAD~1 --full', 'chemx d --conflicts']
  },
  {
    name: 'show',
    aliases: [],
    group: 'wrappers',
    brief: 'One commit: stat, patch',
    usage: 'chemx show [rev] [--patch] [--full] [-- <path>...]',
    summary: 'Subject, author, date, body and stat of one commit (default HEAD).',
    description: 'Runs git show. --patch adds a -U0 patch that collapses past 80 lines unless --full. To read a file at a revision: chemx read <rev>:<path>.',
    flags: [
      { flag: '--patch, -p', desc: 'Append the -U0 patch' },
      { flag: '--full', desc: 'Never collapse the patch' }
    ],
    examples: ['chemx show HEAD~1', 'chemx show a1b2c3d --patch', 'chemx show HEAD --patch -- cli/index.js', 'chemx read HEAD~1:cli/index.js --outline']
  },
  {
    name: 'status',
    aliases: [],
    group: 'wrappers',
    brief: 'git status with live leases',
    usage: 'chemx status [path] [--json] [--as=@you]',
    summary: 'Changed files (git status --porcelain) with each file\'s live lease: holder, purpose, task, minutes left.',
    description: 'Flags a changed file with no live lease (someone may be mid-edit, or the edit is finished) and one leased by a different handle (needs --as or CHEMX_AGENT_ID). Reads only; ends with one line of counts. Matches leases by root-relative key, so a legacy cwd-relative lease in a nested db is not shown.',
    flags: [
      { flag: '--json', desc: 'Output { rows, summary }' },
      { flag: '--as=@you', desc: 'Your handle, to tell your leases from others' }
    ],
    examples: ['chemx status', 'chemx status cli --json --as=@me']
  },
  {
    name: 'wait',
    aliases: [],
    group: 'wrappers',
    brief: 'Wait for a task, lock or idle verify',
    usage: 'chemx wait --task=<id> [--status=done] | --lock-free=<file> | --verify-idle [--timeout=30m]',
    summary: 'Polls every 3 seconds until the condition holds. Exit 0 when met, 2 on timeout, 1 on bad arguments.',
    description: 'The condition is true as of the last poll; it can change right after. --verify-idle reads the process table for chemx verify/test (on Linux only those running inside this project). A task id no db knows keeps waiting until the timeout.',
    flags: [
      { flag: '--task=<id>', desc: 'Until the task reaches --status (default done)' },
      { flag: '--lock-free=<file>', desc: 'Until no unexpired lease exists on the file' },
      { flag: '--verify-idle', desc: 'Until no chemx verify/test process runs for this project' },
      { flag: '--timeout=<dur>', desc: '30s, 5m, 2h or plain seconds; default 30m' }
    ],
    examples: ['chemx wait --task=2565', 'chemx wait --lock-free=cli/main.js --timeout=10m', 'chemx wait --verify-idle']
  },
  {
    name: 'conflicts',
    aliases: [],
    group: 'wrappers',
    brief: 'List merge conflicts and both sides',
    usage: 'chemx conflicts [--json]',
    summary: 'Lists unmerged paths mid-merge or rebase with both sides of every conflict hunk.',
    description: 'Reads git ls-files -u and the working files; ours/base/theirs lines per hunk. Loads before the rest of chemx, so it works while chemx itself is mid-merge.',
    flags: [{ flag: '--json', desc: 'Output { isRepo, unmerged: [{ path, stages, hunks }] }' }],
    examples: ['chemx conflicts', 'chemx conflicts --json', 'chemx d --conflicts']
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
    brief: 'Show package.json scripts and deps',
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
    brief: 'Find files, honoring .gitignore',
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
    brief: 'Show the shape of a JSON file',
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
    brief: 'Run several chemx commands in one process',
    usage: 'chemx do "<cmd1>" "<cmd2>" ...',
    summary: 'Sequential multi-command runner inside a single warm Node process.',
    description: 'Runs several chemx commands in one process. Every item runs even if an earlier one fails or calls exit; the batch exits with the worst item status (fail 1 > inconclusive 3 > pass 0) and prints a summary line.',
    flags: [],
    examples: ['chemx do "d" "p -s" "verify"']
  },
];
