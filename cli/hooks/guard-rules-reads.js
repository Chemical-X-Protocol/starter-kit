// Deny rules for reads and searches that bypass `cat`/`grep`: stdin redirects (`wc -l < file`),
// `xargs cat < list`, `git grep` and `git cat-file`. Each `use` names the chemx call to make.

import { fileOperands, gitSubcommand, inputRedirectTargets, optionValue, stdoutWrites } from './guard-args.js';
import { isRepoPath, isRepoSourcePath } from './guard-paths.js';

const STDIN_READERS = new Set(['wc', 'nl', 'sort', 'uniq', 'cut', 'tac', 'rev', 'fold', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'sha1sum', 'sha256sum', 'cksum', 'base64', 'diff', 'jq']);
const XARGS_READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat']);
const GIT_GREP_VALUE_FLAGS = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '--max-depth', '--threads']);
const CAT_FILE_SCRIPTING_FLAGS = new Set(['-e', '-t', '-s']);
const REV_PATH = /^[^:\s-][^:\s]*:.+/;

const baseName = (word) => String(word ?? '').split('/').pop();

// Repo source files fed to stdin by `< file`, unless stdout is redirected (a copy, not a read).
export const stdinSources = (command, context) => inputRedirectTargets(command).filter((target) => isRepoSourcePath(target, context));

// `git -C dir <sub>` runs in dir, else in the command's cwd: only a repo inside the project counts.
const gitRunsInRepo = (invocation, context) => {
  const { rest } = gitSubcommand(invocation);
  const globalFlags = invocation.args.slice(0, invocation.args.length - rest.length - 1);
  const dir = optionValue(globalFlags, ['-C']) ?? '.';
  return isRepoPath(dir, context);
};

const gitGrepPattern = ({ rest }) => optionValue(rest, ['-e', '--regexp']) ?? fileOperands(rest, GIT_GREP_VALUE_FLAGS)[0] ?? '<text>';

const catFileSpec = ({ rest }) => rest.find((arg) => REV_PATH.test(arg)) ?? null;

const isCatFileRead = (invocation, context) => {
  const git = gitSubcommand(invocation);
  const isCatFile = git.sub === 'cat-file';
  const isScripting = git.rest.some((arg) => CAT_FILE_SCRIPTING_FLAGS.has(arg) || arg.startsWith('--batch'));
  return isCatFile && !isScripting && catFileSpec(git) !== null && gitRunsInRepo(invocation, context);
};

const isXargsReader = (invocation, command, context) => {
  const isXargs = command.argv.some((word) => baseName(word) === 'xargs');
  const listsFiles = fileOperands(invocation.args, new Set()).length === 0;
  const listFile = inputRedirectTargets(command).find((target) => isRepoPath(target, context));
  return isXargs && XARGS_READERS.has(invocation.tool) && listsFiles && listFile !== undefined;
};

export const READ_GAP_RULES = [
  {
    id: 'raw-source-stdin',
    matches: ({ tool }, command, context) => STDIN_READERS.has(tool) && stdinSources(command, context).length > 0 && stdoutWrites(command).length === 0,
    use: (invocation, command, context) => `chemx read ${stdinSources(command, context)[0]} --outline | --symbol=<name> | --start=N --end=M`,
  },
  {
    id: 'raw-xargs-read',
    matches: (invocation, command, context) => isXargsReader(invocation, command, context),
    use: () => 'chemx do "read <file> --outline" "read <file2> --outline"  (xargs cat reads every listed file unlogged)',
  },
  {
    id: 'raw-git-cat-file',
    matches: (invocation, command, context) => isCatFileRead(invocation, context),
    use: (invocation) => `chemx read ${catFileSpec(gitSubcommand(invocation))}  (chemx read <rev>:<path> [--outline|--symbol=<name>])`,
  },
];

export const GIT_GREP_RULE = {
  id: 'raw-git-grep',
  matches: (invocation, command, context) => gitSubcommand(invocation).sub === 'grep' && gitRunsInRepo(invocation, context),
  use: (invocation) => `chemx q -g "${gitGrepPattern(gitSubcommand(invocation))}" [-l]  (symbols: chemx q "<name>")`,
};
