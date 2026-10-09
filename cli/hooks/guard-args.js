// Argument helpers shared by the guard rule files: git subcommand, file operands, redirect targets.

const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const WRITE_REDIRECT_OPS = new Set(['>', '>>', '>|', '&>', '&>>']);
const APPEND_REDIRECT_OPS = new Set(['>>', '&>>']);

export const gitSubcommand = ({ tool, args }) => {
  const isGit = tool === 'git';
  if (!isGit) return { sub: null, rest: [] };
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) index += GIT_VALUE_FLAGS.has(args[index]) ? 2 : 1;
  return { sub: args[index] ?? null, rest: args.slice(index + 1) };
};

export const fileOperands = (args, valueFlags) => {
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

// Redirects that write stdout (or both streams) to a file: [{ op, target, isAppend }].
export const stdoutWrites = (command) => command.redirects
  .filter((redirect) => {
    const isStdout = redirect.fd === null || redirect.fd === '1';
    const isWriteOp = WRITE_REDIRECT_OPS.has(redirect.op);
    return isWriteOp && (isStdout || redirect.op.startsWith('&'));
  })
  .map((redirect) => ({ op: redirect.op, target: redirect.target, isAppend: APPEND_REDIRECT_OPS.has(redirect.op) }));

// Files fed to a command's stdin with `< file` (fd 0 only; heredocs and herestrings carry text, not files).
export const inputRedirectTargets = (command) => command.redirects
  .filter((redirect) => redirect.op === '<' && (redirect.fd === null || redirect.fd === '0'))
  .map((redirect) => redirect.target);

export const hasInPlaceFlag = (args) => args.some((arg) => /^-(?![MmIeE])[a-zA-Z]*i(?:\.[\w~]+)?$/.test(arg) || arg === '--in-place' || arg.startsWith('--in-place='));

// Strip glob stars from a find/glob pattern so it can be used as a `chemx f` substring.
export const globToSubstring = (pattern) => String(pattern).replace(/^\*+/, '').replace(/\*+$/, '');

export const optionValue = (args, names) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const isSplit = names.includes(arg);
    if (isSplit) return args[index + 1] ?? null;
    const joined = names.find((name) => name.startsWith('--') && arg.startsWith(`${name}=`));
    if (joined) return arg.slice(joined.length + 1);
  }
  return null;
};
