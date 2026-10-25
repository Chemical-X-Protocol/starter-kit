/**
 * Chemical X Protocol: the branch a worktree was cut from (#6777, K24).
 * `chemx worktree add` writes `{ branch, base }` to chemx-worktree.json in the worktree's own git dir
 * (`<main>/.git/worktrees/<name>/`, the directory the `.git` pointer file names). That directory is private
 * to the worktree: never part of the working tree, so it is not in `git status` and never committed, and
 * `git worktree remove` or `prune` deletes it with the worktree. `chemx worktree remove` reads it back to
 * judge the branch merged into the branch it was cut from as well as into the default branch.
 * A record belongs to the branch it names: a worktree later switched to another branch has none.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gitDirOf } from './worktree-git.js';

const RECORD_FILE = 'chemx-worktree.json';

const recordPath = (worktreePath) => {
  const gitDir = gitDirOf(worktreePath);
  return gitDir ? path.join(gitDir, RECORD_FILE) : null;
};

/** @returns {{ ok: boolean, problem?: string }} */
export const recordWorktreeBase = (worktreePath, branch, base) => {
  const file = recordPath(worktreePath);
  if (!file) return { ok: false, problem: 'git named no git dir for the worktree' };
  try {
    fs.writeFileSync(file, `${JSON.stringify({ branch, base })}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, problem: err.message };
  }
};

/**
 * The base recorded for `branch` in the worktree at worktreePath.
 * @returns {{ base: string|null, problem: string|null }} base is null when there is no record for this
 * branch; problem says why a record that exists could not be read.
 */
export const readWorktreeBase = (worktreePath, branch) => {
  const file = recordPath(worktreePath);
  const hasRecord = Boolean(file) && fs.existsSync(file);
  if (!hasRecord) return { base: null, problem: null };
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const isForBranch = record.branch === branch && typeof record.base === 'string' && record.base !== '';
    return { base: isForBranch ? record.base : null, problem: null };
  } catch (err) {
    return { base: null, problem: `${RECORD_FILE} in the worktree's git dir is unreadable (${err.message}); delete or fix it` };
  }
};
