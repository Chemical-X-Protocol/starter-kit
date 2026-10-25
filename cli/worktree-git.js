/**
 * Chemical X Protocol: the git side of `chemx worktree` (#6762, K17).
 * Which worktree is the main checkout, which ref a new branch starts from, and whether a branch has
 * reached the default branch. A squash merge leaves the branch's commits out of the default branch's
 * history, so "merged" is two questions: is the branch an ancestor of the base (a merge or a
 * fast-forward), and would merging it change the base's tree at all (a squash). The second is answered
 * with `git merge-tree --write-tree` (git 2.38+), which merges in memory and prints the resulting tree;
 * an older git, or a conflict, answers "not merged" and the caller asks for --force.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runGit } from './commit/commit-git.js';

const DEFAULT_REFS = ['origin/main', 'origin/master', 'main', 'master'];

const refExists = (cwd, ref) => runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0;

/** @returns {{ path: string, head: string, branch: string|null, isMain: boolean }[]} the main checkout is first */
export const listWorktrees = (cwd) => {
  const listed = runGit(cwd, ['worktree', 'list', '--porcelain']);
  const isListed = listed.status === 0;
  if (!isListed) return [];
  return listed.stdout.split('\n\n').filter((block) => block.trim() !== '').map((block, index) => {
    const lines = block.split('\n');
    const field = (name) => lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1) ?? null;
    const branchRef = field('branch');
    return { path: field('worktree'), head: field('HEAD'), branch: branchRef ? branchRef.replace(/^refs\/heads\//, '') : null, isMain: index === 0 };
  });
};

/** The remote's default branch (origin/HEAD), else the first of origin/main, origin/master, main, master that exists; null when none. */
export const defaultBaseRef = (cwd) => {
  const remoteHead = runGit(cwd, ['symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD']);
  const named = remoteHead.status === 0 ? remoteHead.stdout.trim() : '';
  const isNamedUsable = named !== '' && refExists(cwd, named);
  if (isNamedUsable) return named;
  return DEFAULT_REFS.find((ref) => refExists(cwd, ref)) ?? null;
};

export const resolvesToCommit = refExists;

const realpathOr = (target) => (fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target));

/** The absolute git dir of the checkout at cwd (`<main>/.git/worktrees/<name>` in a linked worktree); null outside git. */
export const gitDirOf = (cwd) => {
  const asked = runGit(cwd, ['rev-parse', '--absolute-git-dir']);
  const isAsked = asked.status === 0;
  return isAsked ? asked.stdout.trim() : null;
};

/**
 * Whether cwd is inside a linked worktree rather than the main checkout. A linked worktree's `.git` is a
 * file holding a `gitdir:` pointer into `<main>/.git/worktrees/<name>`; git follows it, so the worktree's
 * own git dir differs from the common dir it shares with the main checkout (a main checkout, a
 * submodule and a subdirectory of either have the two equal). False outside git.
 */
export const isLinkedWorktree = (cwd) => {
  const dirs = runGit(cwd, ['rev-parse', '--git-dir', '--git-common-dir']);
  const isAsked = dirs.status === 0;
  if (!isAsked) return false;
  const [gitDir, commonDir] = dirs.stdout.trim().split('\n').map((dir) => realpathOr(path.resolve(cwd, dir)));
  return gitDir !== commonDir;
};

export const branchExists = (cwd, branch) => runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;

export const shortRef = (cwd, ref) => runGit(cwd, ['rev-parse', '--short', ref]).stdout.trim();

/** A name for `ref` that means the same later: HEAD becomes its branch; a detached HEAD or a bare commit id becomes the full commit id. */
export const durableRef = (cwd, ref) => {
  const named = runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', ref]).stdout.trim();
  const isNamed = named !== '' && named !== 'HEAD';
  return isNamed ? named : runGit(cwd, ['rev-parse', ref]).stdout.trim();
};

/**
 * @returns {'merged'|'squash-merged'|'unmerged'} how the branch stands against `base`
 */
export const mergeState = (cwd, branch, base) => {
  const isAncestor = runGit(cwd, ['merge-base', '--is-ancestor', branch, base]).status === 0;
  if (isAncestor) return 'merged';
  const merged = runGit(cwd, ['merge-tree', '--write-tree', base, branch]);
  const baseTree = runGit(cwd, ['rev-parse', `${base}^{tree}`]).stdout.trim();
  const isCleanMerge = merged.status === 0;
  const changesNothing = isCleanMerge && merged.stdout.split('\n')[0].trim() === baseTree;
  return changesNothing ? 'squash-merged' : 'unmerged';
};

export const addWorktree = (cwd, target, branch, base) => runGit(cwd, ['worktree', 'add', '-b', branch, target, base]);

export const removeWorktree = (cwd, target, isForced) => runGit(cwd, ['worktree', 'remove', ...(isForced ? ['--force'] : []), target]);

/** `-D`, not `-d`: the caller has already shown the branch merged (a squash merge fools `-d`) or was told --force. */
export const deleteBranch = (cwd, branch) => runGit(cwd, ['branch', '-D', branch]);
