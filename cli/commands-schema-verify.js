// Command schema entries for the verify group. Assembled in commands-schema.js.
export const VERIFY_COMMANDS = [
  {
    name: 'verify',
    aliases: ['check:all'],
    group: 'verify',
    brief: 'Run audit, typecheck and tests as one gate',
    usage: 'chemx verify [options]',
    summary: 'Runs the full verification pipeline: AST audit, typecheck and test suite.',
    description: 'Compact single-card verification; silent when green. A repo with its own tests/run-tests.mjs harness runner and no package.json (the WordPress plugins) needs no node_modules and has no typecheck: verify runs php -l over the changed PHP files, the runner, and the audit, and the exit code is the worst of the three.',
    flags: [
      { flag: '--dir=<path>', desc: 'Target directory (default: .chemxrc "scope", else project root)' },
      { flag: '--build', desc: 'Include production build audit step' },
      { flag: '--changed', desc: 'Audit only changed source files and run only the affected specs; typecheck stays whole-project' },
      { flag: '--base=<rev>', desc: 'With --changed: gate each changed file per rule against the merge-base with this revision (delta gate)' },
      { flag: '--json', desc: 'Output the status card as JSON' },
      { flag: '--all', desc: 'In a repo with its own tests/run-tests.mjs runner: php -l every PHP file, not only the changed ones (refused in any other project)' },
      { flag: '--allow-empty', desc: 'Accepted by verify; its effect is not documented here' },
      { flag: '--all-packages', desc: 'Accepted by verify; its effect is not documented here' },
      { flag: '--timeout=<n>', desc: 'Accepted by verify; the unit and scope are not documented here' },
      { flag: '--profile', desc: 'Accepted by verify; its effect is not documented here' }
    ],
    examples: ['chemx verify', 'chemx verify --json']
  },
  {
    name: 'test',
    aliases: ['tests', 'check:test'],
    group: 'verify',
    brief: 'Run tests, show failures only',
    usage: 'chemx test [target] [options] [-- <command>]',
    summary: 'Run the project test suite and report only failures.',
    description: 'Detects the test runner and suppresses passing output. A repo with its own tests/run-tests.mjs harness runner runs one file through a generated copy of it, on the job line.',
    flags: [
      { flag: '--json', desc: 'Output test summary as minified JSON' },
      { flag: '--raw', desc: 'Do not suppress passing test output' },
      { flag: '--slow', desc: 'Run only the slow lane (docs/test-lanes.md)' },
      { flag: '--all', desc: 'Run both lanes' },
      { flag: '-t <name>', desc: 'Only tests whose name matches (alias --filter); extra words join the name, paths and spec files stay targets' },
      { flag: '--changed', desc: 'Run specs affected by changed files, by the import graph, plus the meta specs; a clean tree compares with the merge base of origin/main; a file that loads by a computed path widens the run unless declared open-ok (docs/test-lanes.md)' },
      { flag: '--base=<rev>', desc: 'With --changed: compare from the merge-base with this revision (default HEAD, or the upstream default branch on a clean tree)' },
      { flag: '--related <files...>', desc: 'Run specs affected by the files you name' },
      { flag: '--depth=<n>', desc: 'With --changed or --related: only specs within n import hops (deeper ones are reported as not run)' },
      { flag: '--profile', desc: 'Time each spec file in its own process, slowest first' },
      { flag: '--top=<n>', desc: 'With --profile: show the n slowest' }
    ],
    examples: ['chemx test', 'chemx test src/store.spec.ts --json', 'chemx test --changed --all', 'chemx test -t should do x a.spec.js']
  },
  {
    name: 'typecheck',
    aliases: ['check:types', 'tsc'],
    group: 'verify',
    brief: 'Typecheck, show errors only',
    usage: 'chemx typecheck [options] [-- <command>]',
    summary: 'Run the project type checker and report only diagnostics.',
    description: 'Uses the project typecheck script when present.',
    flags: [
      { flag: '--json', desc: 'Output diagnostics as minified JSON' },
      { flag: '--raw', desc: 'Do not capture or format output' }
    ],
    examples: ['chemx typecheck', 'chemx typecheck --json']
  },
  {
    name: 'lint',
    aliases: ['check:lint', 'eslint'],
    group: 'verify',
    brief: 'Run ESLint, results grouped by file',
    usage: 'chemx lint [path...] [options] [-- <command>]',
    summary: 'Token-conserving linter runner with automatic fix; with paths it also answers chemx check.',
    description: 'Executes ESLint with grouped diagnostics, target scoping and --fix support. With paths it appends the micro-check hazards of those paths (inline booleans, dispatch switches, silent catches: what chemx check prints), so one pass answers both and either failing fails it. A directory with no package.json or no ESLint config (flat or legacy) has nothing for ESLint to read: lint says so in one line ("no ESLint config in <root>; ran chemx check on <n> files instead") and runs chemx check on the named paths, or on every source file under the directory.',
    flags: [
      { flag: '--fix', desc: 'Automatically fix fixable lint errors' },
      { flag: '--json', desc: 'Output structured diagnostics as JSON (hazards, micro and note carry the micro-check side)' },
      { flag: '--raw', desc: 'Do not capture or format output' },
      { flag: '--all-packages', desc: 'At a monorepo root: lint every workspace package (else refused)' }
    ],
    examples: ['chemx lint', 'chemx lint --fix', 'chemx lint src/app.vue --fix', 'chemx lint cli/a.js cli/b.js']
  },
  {
    name: 'build',
    aliases: ['wrap'],
    group: 'verify',
    brief: 'Run the build, show grouped errors',
    usage: 'chemx build [options] [-- <command>]',
    summary: 'Run the build and catalog its diagnostics.',
    description: 'Suppresses compiler noise and groups diagnostics into categories.',
    flags: [
      { flag: '--json', desc: 'Minified JSON format with categorised diagnostics' },
      { flag: '--command="<cmd>"', desc: 'Explicit build command (default: npm run build)' }
    ],
    examples: ['chemx build', 'chemx build -- vite build']
  }
];
