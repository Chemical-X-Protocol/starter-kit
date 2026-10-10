// Guard rules over resolved invocations. A rule only ever sees a word in command position, so
// runner names inside quotes, heredocs, for-lists or argv owned by chemx never match.
// A rule is { id, matches(invocation, command, context), use: string | (invocation, command, context) => string,
// severity?: 'deny' (default) | 'nudge' }. Nudges live in guard-rules-nudge.js.

import { isRepoSourcePath } from './guard-paths.js';
import { fileOperands, gitSubcommand, hasInPlaceFlag, inputRedirectTargets, optionValue, stdoutWrites } from './guard-args.js';
import { READ_GAP_RULES, GIT_GREP_RULE } from './guard-rules-reads.js';
import { SHELL_REWRITE_RULES } from './guard-rules-shell.js';
import { NUDGE_RULES } from './guard-rules-nudge.js';
// The schema router imports every commands-schema-*.js, which agents edit mid-flight. Load it on its
// own so a syntax error there leaves the guard on its built-in rules (every nudge stays active).
let findCommandSchema = null;
try {
  ({ findCommandSchema } = await import('../commands-schema.js'));
} catch { /* chemx-allow: best-effort the schema only hides nudges for commands chemx lacks */ }

const DIFF_SCRIPTING_FLAGS = /^--(?:quiet|exit-code|name-only|name-status|numstat|check|raw)$/;
const LOG_SCRIPTING_FLAGS = /^--(?:format|pretty=(?:format|tformat):)|^--pretty=format|^--format=/;
const READ_TOOLS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat']);
const READ_VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes']);
const GREP_TOOLS = new Set(['grep', 'egrep', 'fgrep']);
const GREP_VALUE_FLAGS = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '--regexp', '--file', '--max-count', '--include', '--exclude', '--exclude-dir', '--context', '--after-context', '--before-context']);
const AWK_VALUE_FLAGS = new Set(['-F', '-v', '-f']);

const isScript = (name, base) => name === base || name.startsWith(`${base}:`);

const readsRepoSource = (operands, command, context) => {
  const isCopy = stdoutWrites(command).length > 0;
  if (isCopy) return false;
  const files = [...operands, ...inputRedirectTargets(command)];
  return files.some((file) => isRepoSourcePath(file, context));
};

// File operands plus `< file` stdin sources.
const withStdin = (files, command) => [...files, ...inputRedirectTargets(command)];

// `sed -n 1,5p file`: the first operand is the script unless it came from -e.
const sedFileOperands = (args) => {
  const operands = fileOperands(args, new Set(['-e', '--expression']));
  const hasExpressionFlag = args.includes('-e') || args.includes('--expression');
  return hasExpressionFlag ? operands : operands.slice(1);
};

const isRecursiveGrep = ({ tool, args }) => {
  const isGrep = GREP_TOOLS.has(tool);
  if (!isGrep) return false;
  return args.some((arg) => arg === '--recursive' || /^-[a-zA-Z]*[rR]/.test(arg));
};

// A grep with no file operand filters stdin (a pipe filter) and stays free.
const grepParts = ({ args }) => {
  const operands = fileOperands(args, GREP_VALUE_FLAGS);
  const patternFlag = optionValue(args, ['-e', '--regexp']);
  const hasPatternFlag = patternFlag !== null;
  return hasPatternFlag ? { pattern: patternFlag, files: operands } : { pattern: operands[0] ?? '<text>', files: operands.slice(1) };
};

const awkParts = ({ args }) => {
  const operands = fileOperands(args, AWK_VALUE_FLAGS);
  const hasProgramFile = args.includes('-f');
  return hasProgramFile ? operands : operands.slice(1);
};

const firstRepoSource = (files, context) => files.find((file) => isRepoSourcePath(file, context));

export const RUNNER_RULES = [
  { id: 'raw-test-runner', use: 'chemx test [file] [--filter=<name>]', matches: ({ tool }) => tool === 'vitest' || tool === 'jest' },
  { id: 'raw-test-script', use: 'chemx test (or chemx verify)', matches: ({ tool, via }) => Boolean(via) && isScript(tool, 'test') },
  { id: 'raw-typecheck', use: 'chemx typecheck', matches: ({ tool, via }) => tool === 'tsc' || tool === 'vue-tsc' || (Boolean(via) && (isScript(tool, 'typecheck') || isScript(tool, 'type-check'))) },
  { id: 'raw-lint', use: 'chemx lint [path] [--fix]', matches: ({ tool, via }) => tool === 'eslint' || (Boolean(via) && isScript(tool, 'lint')) },
  { id: 'raw-build', use: 'chemx build -- <build command>', matches: ({ tool, via, args }) => (Boolean(via) && isScript(tool, 'build')) || (tool === 'vite' && args[0] === 'build') },
  { id: 'raw-git-diff', use: 'chemx d [git diff args] [--full]', matches: (invocation) => { const { sub, rest } = gitSubcommand(invocation); return sub === 'diff' && !rest.some((arg) => DIFF_SCRIPTING_FLAGS.test(arg)); } },
  { id: 'raw-git-log', use: 'chemx log [-n N] [git log args]', matches: (invocation) => { const { sub, rest } = gitSubcommand(invocation); return sub === 'log' && !rest.some((arg) => LOG_SCRIPTING_FLAGS.test(arg)); } },
  {
    id: 'raw-source-read',
    matches: ({ tool, args }, command, context) => READ_TOOLS.has(tool) && readsRepoSource(fileOperands(args, READ_VALUE_FLAGS), command, context),
    use: ({ args }, command, context) => `chemx read ${firstRepoSource(withStdin(fileOperands(args, READ_VALUE_FLAGS), command), context)} --outline | --symbol=<name> | --start=N --end=M`,
  },
  {
    id: 'raw-source-sed',
    matches: ({ tool, args }, command, context) => tool === 'sed' && !hasInPlaceFlag(args) && readsRepoSource(sedFileOperands(args), command, context),
    use: ({ args }, command, context) => `chemx read ${firstRepoSource(withStdin(sedFileOperands(args), command), context)} --start=N --end=M`,
  },
  ...READ_GAP_RULES,
  ...SHELL_REWRITE_RULES,
];

export const SEARCH_RULES = [
  { id: 'raw-recursive-grep', use: 'chemx q -g "<text>" [-l]  (symbols: chemx q "<name>")', matches: (invocation) => isRecursiveGrep(invocation) },
  GIT_GREP_RULE,
  { id: 'raw-search-tool', use: 'chemx q -g "<text>" [-l]', matches: ({ tool }) => tool === 'rg' || tool === 'ag' || tool === 'ack' },
  {
    id: 'raw-grep-source',
    matches: (invocation, command, context) => GREP_TOOLS.has(invocation.tool) && firstRepoSource(withStdin(grepParts(invocation).files, command), context) !== undefined,
    use: (invocation, command, context) => `chemx q -g "${grepParts(invocation).pattern}" --dir=${firstRepoSource(withStdin(grepParts(invocation).files, command), context)}  (line ranges: chemx read <file> --start=N --end=M)`,
  },
  {
    id: 'raw-awk-source',
    matches: (invocation, command, context) => invocation.tool === 'awk' && firstRepoSource(withStdin(awkParts(invocation), command), context) !== undefined,
    use: (invocation, command, context) => `chemx read ${firstRepoSource(withStdin(awkParts(invocation), command), context)} --start=N --end=M`,
  },
];

const hasChemxCommand = (context, name) => {
  const probe = context.hasChemxCommand ?? ((command) => findCommandSchema === null || findCommandSchema(command) !== null);
  return probe(name);
};

export const activeRules = (context) => {
  const nudges = NUDGE_RULES.filter((rule) => hasChemxCommand(context, rule.command));
  const base = context.enforceSearch ? [...RUNNER_RULES, ...SEARCH_RULES] : RUNNER_RULES;
  return [...base, ...nudges];
};
