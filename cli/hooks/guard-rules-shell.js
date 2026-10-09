// Deny rules for shell commands that chemx replaces one-to-one: writes into repo files (redirects,
// heredocs, tee, sed -i, perl -i), node --test, git show and find. Each `use` fills in the real
// arguments of the command being denied.

import { fileOperands, gitSubcommand, stdoutWrites, globToSubstring, optionValue } from './guard-args.js';
import { isRepoWritePath, isRepoPath } from './guard-paths.js';

const IN_PLACE_FLAG = /^-(?![MmIeE])[a-zA-Z]*i(?:\.[\w~]+)?$/;
const SED_SCRIPT_FLAGS = new Set(['-e', '--expression', '-f', '--file']);
const PERL_SCRIPT_FLAG = /^-[a-zA-Z]*[eEIMm]$/;
const SIMPLE_TEXT = /^[^\\[\]*^$.+?(){}|&]*$/;
const SUBSTITUTION = /^s([/|#,@])(.*?)\1(.*?)\1[gI]*$/;
const TEST_VALUE_FLAGS = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--import', '--require', '-r', '--loader', '--experimental-loader']);
const SHOW_SCRIPTING_FLAGS = /^(?:--(?:format|pretty)(?:=.*)?|--name-only|--name-status|--no-patch|--quiet|-s)$/;
const FIND_MUTATING_TESTS = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/;

const writeHint = (file, isAppend) => (isAppend
  ? `chemx write ${file} --append - <<'EOF'`
  : `chemx write ${file} - <<'EOF' (add --overwrite when the file exists)`);

const patchHint = (file, script) => {
  const found = String(script ?? '').match(SUBSTITUTION);
  const isLiteral = found !== null && SIMPLE_TEXT.test(found[2]) && SIMPLE_TEXT.test(found[3]);
  const base = `chemx patch ${file} <<'EOF'`;
  if (isLiteral) return `${base} with one block: <<<<<<< SEARCH "${found[2]}" ======= "${found[3]}" >>>>>>> REPLACE, each marker on its own line`;
  return `${base} with <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks (patch matches literal text, not regexes)`;
};

const redirectTargets = (command, context) => stdoutWrites(command).filter((write) => isRepoWritePath(write.target, context));

const teeTargets = ({ args }, context) => fileOperands(args, new Set()).filter((operand) => isRepoWritePath(operand, context));

const sedParts = ({ args }) => {
  const hasScriptFlag = args.some((arg) => SED_SCRIPT_FLAGS.has(arg));
  const operands = fileOperands(args, SED_SCRIPT_FLAGS);
  return hasScriptFlag
    ? { script: optionValue(args, ['-e', '--expression']), files: operands }
    : { script: operands[0] ?? null, files: operands.slice(1) };
};

const perlParts = ({ args }) => {
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const takesValue = PERL_SCRIPT_FLAG.test(args[index]);
    if (takesValue) { index += 1; continue; }
    const isOperand = !args[index].startsWith('-');
    if (isOperand) files.push(args[index]);
  }
  const scriptIndex = args.findIndex((arg) => /^-[a-zA-Z]*[eE]$/.test(arg));
  return { script: scriptIndex === -1 ? null : args[scriptIndex + 1], files };
};

const inPlaceTargets = (parts, args, context) => {
  const isInPlace = args.some((arg) => IN_PLACE_FLAG.test(arg) || arg === '--in-place' || arg.startsWith('--in-place='));
  return isInPlace ? parts.files.filter((file) => isRepoWritePath(file, context)) : [];
};

// gawk `-i inplace` rewrites its file operands; the program is the first operand unless -f names it.
const awkInPlaceFiles = ({ args }, context) => {
  const isInPlace = args.some((arg, index) => (arg === '-i' && args[index + 1] === 'inplace') || arg === '-iinplace' || arg === '--include=inplace');
  const operands = fileOperands(args, new Set(['-F', '-v', '-f', '-i']));
  const files = args.includes('-f') ? operands : operands.slice(1);
  return isInPlace ? files.filter((file) => isRepoWritePath(file, context)) : [];
};

const nodeTestParts = ({ args }) => {
  const files = fileOperands(args, TEST_VALUE_FLAGS);
  return { files, name: optionValue(args, ['--test-name-pattern']) };
};

const showParts = ({ rest }) => {
  const separator = rest.indexOf('--');
  const beforePaths = separator === -1 ? rest : rest.slice(0, separator);
  const paths = separator === -1 ? [] : rest.slice(separator + 1);
  const rev = fileOperands(beforePaths, new Set())[0] ?? null;
  return { rev, paths, hasPatch: rest.includes('-p') || rest.includes('--patch') };
};

const findRoots = (args) => {
  const end = args.findIndex((arg) => arg.startsWith('-') || arg === '(' || arg === '!');
  const roots = end === -1 ? args : args.slice(0, end);
  return roots.length > 0 ? roots : ['.'];
};

const isPlainRepoFind = ({ tool, args }, context) => {
  const isFind = tool === 'find';
  const isMutating = args.some((arg) => FIND_MUTATING_TESTS.test(arg));
  return isFind && !isMutating && findRoots(args).some((root) => isRepoPath(root, context));
};

export const SHELL_REWRITE_RULES = [
  {
    id: 'shell-redirect-write',
    matches: (invocation, command, context) => redirectTargets(command, context).length > 0,
    use: (invocation, command, context) => {
      const [first] = redirectTargets(command, context);
      return writeHint(first.target, first.isAppend);
    },
  },
  {
    id: 'shell-tee-write',
    matches: (invocation, command, context) => invocation.tool === 'tee' && teeTargets(invocation, context).length > 0,
    use: (invocation, command, context) => writeHint(teeTargets(invocation, context)[0], invocation.args.includes('-a') || invocation.args.includes('--append')),
  },
  {
    id: 'shell-sed-in-place',
    matches: ({ tool, args }, command, context) => tool === 'sed' && inPlaceTargets(sedParts({ args }), args, context).length > 0,
    use: ({ args }, command, context) => patchHint(inPlaceTargets(sedParts({ args }), args, context)[0], sedParts({ args }).script),
  },
  {
    id: 'shell-perl-in-place',
    matches: ({ tool, args }, command, context) => tool === 'perl' && inPlaceTargets(perlParts({ args }), args, context).length > 0,
    use: ({ args }, command, context) => patchHint(inPlaceTargets(perlParts({ args }), args, context)[0], perlParts({ args }).script),
  },
  {
    id: 'shell-awk-in-place',
    matches: (invocation, command, context) => invocation.tool === 'awk' && awkInPlaceFiles(invocation, context).length > 0,
    use: (invocation, command, context) => patchHint(awkInPlaceFiles(invocation, context)[0], null),
  },
  {
    id: 'raw-node-test',
    matches: ({ tool, args }) => tool === 'node' && (args.includes('--test') || args.includes('--test-only')),
    use: (invocation) => {
      const { files, name } = nodeTestParts(invocation);
      const target = files.length > 0 ? files.join(' ') : '<file>';
      return `chemx test ${target}${name ? ` -t "${name}"` : ''}`;
    },
  },
  {
    id: 'raw-git-show',
    matches: (invocation) => {
      const { sub, rest } = gitSubcommand(invocation);
      return sub === 'show' && !rest.some((arg) => SHOW_SCRIPTING_FLAGS.test(arg));
    },
    use: (invocation) => {
      const { rev, paths, hasPatch } = showParts(gitSubcommand(invocation));
      const isFileAtRevision = rev !== null && rev.includes(':');
      if (isFileAtRevision) return `chemx read ${rev}  (chemx read <rev>:<path> [--outline|--symbol=<name>])`;
      return `chemx show${rev ? ` ${rev}` : ''}${hasPatch ? ' --patch' : ''}${paths.length > 0 ? ` -- ${paths.join(' ')}` : ''}`;
    },
  },
  {
    id: 'raw-find',
    matches: (invocation, command, context) => isPlainRepoFind(invocation, context),
    use: ({ args }) => {
      const name = optionValue(args, ['-name', '-iname', '-path', '-ipath']);
      const needle = name === null ? findRoots(args)[0] : globToSubstring(name);
      return `chemx f "${needle}"`;
    },
  },
];
