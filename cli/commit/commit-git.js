/**
 * Chemical X Protocol: the git side of `chemx commit` (#2564).
 * Every call is an argv array to git (no shell). The commit itself is path-limited
 * (`git commit -m ... -- <files>`), so nothing outside the listed files can ride along, and the
 * repository's own pre-commit hook always runs: this module never passes --no-verify.
 * Limit: git does not record who holds .git/index.lock, so the holder pid comes from fuser or lsof
 * when one of them is installed, and is reported as unknown otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as defaultSleep } from 'node:timers/promises';

const ANSI = /\u001b\[[0-9;]*m/g;
export const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 3500, 5000, 8000];

export const runGit = (cwd, args, env = process.env) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI, '');
  return { status: result.status ?? 1, stdout: result.stdout ?? '', output };
};

export const gitRoot = (cwd) => {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  const isRepo = result.status === 0;
  return isRepo ? result.stdout.trim() : null;
};

const splitNul = (text) => text.split('\0').filter(Boolean);

/** Paths currently staged, relative to the repository root. */
export const stagedPaths = (root) => splitNul(runGit(root, ['diff', '--cached', '--name-only', '-z']).stdout);

/** Paths among `files` that the index would commit, relative to the repository root. */
export const stagedAmong = (root, files) => splitNul(runGit(root, ['diff', '--cached', '--name-only', '-z', '--', ...files]).stdout);

/** Whether a file is known to git or present on disk; a typo is neither. */
export const isKnownFile = (root, file) => {
  const isOnDisk = fs.existsSync(path.resolve(root, file));
  const isTracked = runGit(root, ['ls-files', '--error-unmatch', '--', file]).status === 0;
  return isOnDisk || isTracked;
};

export const shortSha = (root) => runGit(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();

/** Whether a pre-commit hook exists in the hooks directory git will use. */
export const hasPreCommitHook = (root) => {
  const hooksDir = runGit(root, ['rev-parse', '--git-path', 'hooks']).stdout.trim();
  const hookPath = path.resolve(root, hooksDir, 'pre-commit');
  return fs.existsSync(hookPath);
};

const indexLockPath = (root) => path.resolve(root, runGit(root, ['rev-parse', '--git-path', 'index.lock']).stdout.trim());

const pidFromTool = (tool, args) => {
  const result = spawnSync(tool, args, { encoding: 'utf-8' });
  const found = `${result.stdout ?? ''} ${result.stderr ?? ''}`.match(/\b\d{2,}\b/);
  return found ? Number(found[0]) : null;
};

/** The pid holding the index lock, or null when it cannot be found (best effort). */
export const findIndexLockHolder = (root) => {
  const lockPath = indexLockPath(root);
  return pidFromTool('fuser', [lockPath]) ?? pidFromTool('lsof', ['-t', lockPath]);
};

export const isIndexLockFailure = (output) => /index\.lock/.test(output);

/**
 * Runs one git command (add or commit) and retries only when the failure names index.lock.
 * @returns {Promise<{ status: number, output: string, attempts: number, lockHolder: number|null, lockedOut: boolean }>}
 */
export const gitWithRetry = async (root, commitArgs, options = {}) => {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const env = options.env ?? process.env;
  let attempt = runGit(root, commitArgs, env);
  let attempts = 1;
  for (const delay of delays) {
    const shouldRetry = attempt.status !== 0 && isIndexLockFailure(attempt.output);
    if (!shouldRetry) break;
    await sleep(delay);
    attempt = runGit(root, commitArgs, env);
    attempts += 1;
  }
  const lockedOut = attempt.status !== 0 && isIndexLockFailure(attempt.output);
  const lockHolder = lockedOut ? findIndexLockHolder(root) : null;
  return { status: attempt.status, output: attempt.output, attempts, lockHolder, lockedOut };
};

/** The last lines of a hook failure, indented, so a failing gate stays readable and short. */
export const compactFailure = (output, maxLines = 20) => {
  const lines = output.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const dropped = Math.max(0, lines.length - maxLines);
  const kept = lines.slice(-maxLines).map((line) => `  ${line}`);
  const note = dropped > 0 ? [`  (${dropped} earlier line(s) omitted)`] : [];
  return [...note, ...kept];
};
