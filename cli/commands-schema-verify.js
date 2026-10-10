// Command schema entries for the verify group. Assembled in commands-schema.js.
export const VERIFY_COMMANDS = [
  {
    name: 'verify',
    aliases: ['check:all'],
    group: 'verify',
    brief: 'Run audit, typecheck and tests as one gate',
    usage: 'chemx verify [options]',
    summary: 'Runs the full verification pipeline: AST audit, typecheck and test suite.',
    description: 'Compact single-card verification; silent when green.',
    flags: [
      { flag: '--dir=<path>', desc: 'Target directory (default: .chemxrc "scope", else project root)' },
      { flag: '--build', desc: 'Include production build audit step' },
      { flag: '--changed', desc: 'Audit only changed source files and run only the affected specs; typecheck stays whole-project' },
      { flag: '--base=<rev>', desc: 'With --changed: compare against this revision' },
      { flag: '--json', desc: 'Output the status card as JSON' },
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
    description: 'Detects the test runner and suppresses passing output.',
    flags: [
      { flag: '--json', desc: 'Output test summary as minified JSON' },
      { flag: '--raw', desc: 'Do not suppress passing test output' },
      { flag: '--slow', desc: 'Run only the slow lane (docs/test-lanes.md)' },
      { flag: '--all', desc: 'Run both lanes' },
      { flag: '--changed', desc: 'Run specs affected by changed files, by the import graph' },
      { flag: '--base=<rev>', desc: 'With --changed: compare against this revision' },
      { flag: '--related <files...>', desc: 'Run specs affected by the files you name' },
      { flag: '--depth=<n>', desc: 'With --changed or --related: only specs within n import hops (deeper ones are reported as not run)' },
      { flag: '--profile', desc: 'Time each spec file in its own process, slowest first' },
      { flag: '--top=<n>', desc: 'With --profile: show the n slowest' }
    ],
    examples: ['chemx test', 'chemx test src/store.spec.ts --json']
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
    usage: 'chemx lint [path] [options] [-- <command>]',
    summary: 'Token-conserving linter runner with automatic fix.',
    description: 'Executes ESLint with grouped diagnostics, target scoping and --fix support.',
    flags: [
      { flag: '--fix', desc: 'Automatically fix fixable lint errors' },
      { flag: '--json', desc: 'Output structured diagnostics as JSON' },
      { flag: '--raw', desc: 'Do not capture or format output' }
    ],
    examples: ['chemx lint', 'chemx lint --fix', 'chemx lint src/app.vue --fix']
  },
  {
    name: 'build',
    aliases: ['run', 'wrap'],
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
