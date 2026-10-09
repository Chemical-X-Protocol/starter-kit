// Guard rules over resolved invocations. A rule only ever sees a word in command position, so
// runner names inside quotes, heredocs, for-lists or argv owned by chemx never match.

import { isRepoSourcePath } from './guard-paths.js';

const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const DIFF_SCRIPTING_FLAGS = /^--(?:quiet|exit-code|name-only|name-status|numstat|check|raw)$/;
const LOG_SCRIPTING_FLAGS = /^--(?:format|pretty=(?:format|tformat):)|^--pretty=format|^--format=/;
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>']);
const READ_TOOLS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat']);
const READ_VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes']);

const isScript = (name, base) => name === base || name.startsWith(`${base}:`);

const gitSubcommand = ({ tool, args }) => {
  const isGit = tool === 'git';
  if (!isGit) return { sub: null, rest: [] };
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) index += GIT_VALUE_FLAGS.has(args[index]) ? 2 : 1;
  return { sub: args[index] ?? null, rest: args.slice(index + 1) };
};

const fileOperands = (args, valueFlags) => {
  const operands = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const takesValue = valueFlags.has(arg);
    if (takesValue) { index += 1; continue; }
    const isOperand = !arg.startsWith('-') || arg === '-';
    if (isOperand) operands.push(arg);
  }
  return operands;
};

const writesStdoutToFile = (command) => command.redirects.some((redirect) => {
  const isStdout = redirect.fd === null || redirect.fd === '1';
  return isStdout && WRITE_REDIRECTS.has(redirect.op);
});

const readsRepoSource = (operands, command, context) => {
  const isCopy = writesStdoutToFile(command);
  if (isCopy) return false;
  return operands.some((operand) => isRepoSourcePath(operand, context));
};

// `sed -n 1,5p file`: the first operand is the script unless it came from -e.
const sedFileOperands = (args) => {
  const operands = fileOperands(args, new Set(['-e', '--expression']));
  const hasExpressionFlag = args.includes('-e') || args.includes('--expression');
  return hasExpressionFlag ? operands : operands.slice(1);
};

const isRecursiveGrep = ({ tool, args }) => {
  const isGrep = tool === 'grep' || tool === 'egrep';
  if (!isGrep) return false;
  return args.some((arg) => arg === '--recursive' || /^-[a-zA-Z]*[rR]/.test(arg));
};

export const RUNNER_RULES = [
  { id: 'raw-test-runner', use: 'chemx test [file] [--filter=<name>]', matches: ({ tool }) => tool === 'vitest' || tool === 'jest' },
  { id: 'raw-test-script', use: 'chemx test (or chemx verify)', matches: ({ tool, via }) => Boolean(via) && isScript(tool, 'test') },
  { id: 'raw-typecheck', use: 'chemx typecheck', matches: ({ tool, via }) => tool === 'tsc' || tool === 'vue-tsc' || (Boolean(via) && (isScript(tool, 'typecheck') || isScript(tool, 'type-check'))) },
  { id: 'raw-lint', use: 'chemx lint [path] [--fix]', matches: ({ tool, via }) => tool === 'eslint' || (Boolean(via) && isScript(tool, 'lint')) },
  { id: 'raw-build', use: 'chemx build -- <build command>', matches: ({ tool, via, args }) => (Boolean(via) && isScript(tool, 'build')) || (tool === 'vite' && args[0] === 'build') },
  { id: 'raw-git-diff', use: 'chemx d [git diff args] [--full]', matches: (invocation) => { const { sub, rest } = gitSubcommand(invocation); return sub === 'diff' && !rest.some((arg) => DIFF_SCRIPTING_FLAGS.test(arg)); } },
  { id: 'raw-git-log', use: 'chemx log [-n N] [git log args]', matches: (invocation) => { const { sub, rest } = gitSubcommand(invocation); return sub === 'log' && !rest.some((arg) => LOG_SCRIPTING_FLAGS.test(arg)); } },
  { id: 'raw-source-read', use: 'chemx read <file> --outline | --symbol=<name> | --start=N --end=M (or the native Read tool)', matches: ({ tool, args }, command, context) => READ_TOOLS.has(tool) && readsRepoSource(fileOperands(args, READ_VALUE_FLAGS), command, context) },
  { id: 'raw-source-sed', use: 'chemx read <file> --start=N --end=M (or the native Read tool)', matches: ({ tool, args }, command, context) => tool === 'sed' && args.includes('-n') && readsRepoSource(sedFileOperands(args), command, context) },
];

export const SEARCH_RULES = [
  { id: 'raw-recursive-grep', use: 'chemx q -g "<text>" [-l]  (symbols: chemx q "<name>")', matches: (invocation) => isRecursiveGrep(invocation) },
  { id: 'raw-search-tool', use: 'chemx q -g "<text>" [-l]', matches: ({ tool }) => tool === 'rg' || tool === 'ag' || tool === 'ack' },
];

export const activeRules = ({ enforceSearch }) => (enforceSearch ? [...RUNNER_RULES, ...SEARCH_RULES] : RUNNER_RULES);
