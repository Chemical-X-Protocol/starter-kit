// chemx show <rev>: one commit, token-lean. Subject, author, date and body, then the stat;
// --patch adds a -U0 patch that collapses past the chemx d budget unless --full.
import { runGit, emitWrapperResult, isInsideWorkTree, DIFF_LINE_BUDGET, NOT_A_REPO_CODE } from './cmd-wrappers-git.js';

const PATCH_FLAGS = new Set(['--patch', '-p']);
const OWN_FLAGS = new Set([...PATCH_FLAGS, '--full']);
const HEADER_FORMAT = 'commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%w(0,4,4)%s%n%n%w(0,4,4)%b';

const parseShowArgs = (subArgs) => {
  const separator = subArgs.indexOf('--');
  const hasSeparator = separator !== -1;
  const before = hasSeparator ? subArgs.slice(0, separator) : subArgs;
  const pathspecs = hasSeparator ? subArgs.slice(separator) : [];
  const rev = before.find((a) => !a.startsWith('-')) || 'HEAD';
  const passthrough = before.filter((a) => a !== rev && !OWN_FLAGS.has(a));
  return {
    rev,
    wantsPatch: before.some((a) => PATCH_FLAGS.has(a)),
    isFull: before.includes('--full'),
    tail: [...passthrough, ...pathspecs]
  };
};

const compactPatch = (patch, rev, isFull) => {
  const lineCount = patch.split('\n').length;
  const isOverBudget = !isFull && lineCount > DIFF_LINE_BUDGET;
  if (!isOverBudget) return patch;
  return `// [Patch compacted (${lineCount} lines). Use chemx show ${rev} --patch --full for the full patch]\n`;
};

export const runShow = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const subArgs = rawArgs.filter((a) => a !== 'show');
  const isOutsideRepo = !isInsideWorkTree(cwd);
  if (isOutsideRepo) return emitWrapperResult({ output: '', code: NOT_A_REPO_CODE, error: `not a git repository: ${cwd}` }, isCli);
  const { rev, wantsPatch, isFull, tail } = parseShowArgs(subArgs);
  const header = runGit(['show', '-s', '--no-color', '--date=iso', `--format=${HEADER_FORMAT}`, rev], cwd);
  if (header.code !== 0) return emitWrapperResult({ output: '', code: header.code, error: header.error }, isCli);
  const stat = runGit(['show', '--stat', '--format=', '--no-color', rev, ...tail], cwd);
  if (stat.code !== 0) return emitWrapperResult({ output: '', code: stat.code, error: stat.error }, isCli);
  const headerText = header.stdout.split('\n').map((line) => line.trimEnd()).join('\n').trimEnd();
  const parts = [headerText, '', stat.stdout.replace(/^\n+/, '').trimEnd()];
  if (wantsPatch) {
    const patch = runGit(['show', '-U0', '--format=', '--no-color', rev, ...tail], cwd);
    if (patch.code !== 0) return emitWrapperResult({ output: '', code: patch.code, error: patch.error }, isCli);
    parts.push('', compactPatch(patch.stdout.replace(/^\n+/, '').trimEnd(), rev, isFull).trimEnd());
  }
  return emitWrapperResult({ output: `${parts.join('\n')}\n`, code: 0 }, isCli);
};
