/**
 * Chemical X Protocol: put the index back the way it was for the files `chemx commit` staged (#2579).
 * Guarantees: only the listed paths are touched; entries other handles staged are never read back or
 * rewritten. Not guaranteed: a restore that itself fails (for example a held .git/index.lock) is
 * reported as false and the listed files then stay staged.
 */
import { spawnSync } from 'node:child_process';
import { runGit } from './commit-git.js';

/** The index entries (`<mode> <sha> <stage>\t<path>`) the listed paths have right now. */
export const snapshotIndex = (root, files) => {
  const listing = runGit(root, ['ls-files', '-s', '-z', '--', ...files]).stdout;
  return listing.split('\0').filter(Boolean);
};

const pathOfEntry = (entry) => entry.slice(entry.indexOf('\t') + 1);

/**
 * Restores the listed paths to a snapshot: entries that existed come back as they were, paths that
 * had none are removed from the index (the working tree is left alone).
 * @returns {boolean} whether the index was restored
 */
export const restoreIndex = (root, files, snapshot) => {
  const before = new Set(snapshot.map(pathOfEntry));
  const added = files.filter((file) => !before.has(file));
  const hasAdded = added.length > 0;
  const removal = hasAdded ? runGit(root, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...added]) : { status: 0 };
  const isRemovalFailed = removal.status !== 0;
  const hasNothingToRestore = snapshot.length === 0;
  const isDone = isRemovalFailed || hasNothingToRestore;
  if (isDone) return !isRemovalFailed;
  const input = snapshot.map((entry) => `${entry}\n`).join('');
  const result = spawnSync('git', ['update-index', '--index-info'], { cwd: root, encoding: 'utf-8', input });
  return result.status === 0;
};
