// chemx d / chemx log: token-lean git wrappers. git failures are reported, never shown as empty success.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs', '.cjs']);
const MAX_MICRO_SYNC_FILES = 5;

// Opportunistically re-index up to 5 modified source files. Best effort by design.
// Only runs when the project already has an index, and loads the AST stack lazily,
// so `chemx d` stays cheap.
const tryMicroSyncModifiedFiles = async (cwd) => {
  const hasIndexDb = fs.existsSync(path.join(cwd, '.chemx', 'index.db'));
  if (!hasIndexDb) return;
  let statusOut = '';
  try {
    statusOut = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 });
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[d] micro-sync skipped: ${err.message}\n`);
    return;
  }
  const modified = statusOut.split('\n').map((line) => line.slice(3).trim()).filter((f) => SOURCE_EXTENSIONS.has(path.extname(f)));
  const isSmallChangeSet = modified.length > 0 && modified.length <= MAX_MICRO_SYNC_FILES;
  if (!isSmallChangeSet) return;
  const { syncSingleFileIndex } = await import('../search.js');
  for (const file of modified) {
    try {
      syncSingleFileIndex(file, cwd);
    } catch (err) {
      if (process.env.CHEMX_DEBUG) process.stderr.write(`[d] micro-sync failed for ${file}: ${err.message}\n`);
    }
  }
};

export const runGit = (gitArgs, cwd) => {
  const res = spawnSync('git', gitArgs, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error) return { stdout: '', code: 1, error: `git error: ${res.error.message}` };
  const code = res.status ?? 1;
  const isFailure = code !== 0;
  const stderr = (res.stderr || '').trim();
  const error = isFailure ? (stderr || `git ${gitArgs[0]} exited with code ${code}`) : '';
  return { stdout: res.stdout || '', code, error };
};

export const emitWrapperResult = (result, isCli) => {
  if (!isCli) return result;
  if (result.output) process.stdout.write(result.output);
  if (result.error) process.stderr.write(`${result.error}\n`);
  return result;
};

export const DIFF_LINE_BUDGET = 80;
export const NOT_A_REPO_CODE = 128;
// Output formats that are already summaries: never "compact" them to --stat.
const SUMMARY_FORMAT_FLAGS = new Set(['--stat', '--shortstat', '--numstat', '--dirstat', '--name-only', '--name-status', '--summary', '--compact-summary', '--raw', '--no-patch']);
// `-U<n>` implies --patch in git, so -U0 is only added when the caller wants a patch.
const PATCH_FLAGS = new Set(['-p', '-u', '--patch', '--patch-with-stat', '--patch-with-raw']);

const isSummaryOnlyRequest = (gitArgs) => {
  const isSummaryFormat = gitArgs.some((a) => SUMMARY_FORMAT_FLAGS.has(a.split('=')[0]));
  const wantsPatch = gitArgs.some((a) => PATCH_FLAGS.has(a) || /^(-U|--unified)/.test(a));
  return isSummaryFormat && !wantsPatch;
};

// Outside a work tree git diff silently becomes --no-index and prints ~100 lines of usage.
export const isInsideWorkTree = (cwd) => runGit(['rev-parse', '--is-inside-work-tree'], cwd).stdout.trim() === 'true';

export const runDiff = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const subArgs = rawArgs.filter((a) => a !== 'd' && a !== 'diff');
  const wantsConflicts = subArgs.includes('--conflicts');
  if (wantsConflicts) {
    const { conflictDiff } = await import('../conflicts-cli.js');
    return emitWrapperResult(conflictDiff(subArgs, cwd), isCli);
  }
  const isFull = subArgs.includes('--full');
  const gitArgs = subArgs.filter((a) => a !== '--full');
  const isExplicitNoIndex = gitArgs.includes('--no-index');
  const isOutsideRepo = !isExplicitNoIndex && !isInsideWorkTree(cwd);
  if (isOutsideRepo) return emitWrapperResult({ output: '', code: NOT_A_REPO_CODE, error: `not a git repository: ${cwd}` }, isCli);
  await tryMicroSyncModifiedFiles(cwd);
  const isSummaryOnly = isSummaryOnlyRequest(gitArgs);
  const contextArgs = isSummaryOnly ? [] : ['-U0'];
  const diff = runGit(['diff', ...contextArgs, '--no-color', ...gitArgs], cwd);
  const isFailure = diff.code !== 0;
  if (isFailure) return emitWrapperResult({ output: diff.stdout, code: diff.code, error: diff.error }, isCli);
  const lineCount = diff.stdout.split('\n').length;
  const isOverBudget = !isFull && !isSummaryOnly && lineCount > DIFF_LINE_BUDGET;
  if (!isOverBudget) return emitWrapperResult({ output: diff.stdout, code: 0 }, isCli);
  const stat = runGit(['diff', '--stat', '--no-color', ...gitArgs], cwd);
  const statOut = stat.stdout.trim();
  const isStatShorter = stat.code === 0 && statOut.length > 0 && statOut.split('\n').length < lineCount;
  if (!isStatShorter) return emitWrapperResult({ output: diff.stdout, code: 0 }, isCli);
  const compacted = `${statOut}\n// [Diff compacted to --stat (${lineCount} lines). Use chemx d --full for uncompressed output]\n`;
  return emitWrapperResult({ output: compacted, code: 0, compacted: true }, isCli);
};

const parseLogArgs = (subArgs) => {
  let limit = 10;
  const passthrough = [];
  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    const isSpacedLimit = arg === '-n' && subArgs[i + 1];
    if (isSpacedLimit) limit = parseInt(subArgs[++i], 10) || 10;
    else if (arg.startsWith('-n')) limit = parseInt(arg.slice(2), 10) || 10;
    else if (/^\d+$/.test(arg)) limit = parseInt(arg, 10);
    else passthrough.push(arg);
  }
  return { limit, passthrough };
};

export const runLog = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const { limit, passthrough } = parseLogArgs(rawArgs.filter((a) => a !== 'log'));
  const log = runGit(['log', '--oneline', `--max-count=${limit}`, '--no-color', ...passthrough], cwd);
  return emitWrapperResult({ output: log.stdout, code: log.code, error: log.error }, isCli);
};
