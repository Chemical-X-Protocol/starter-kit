// One git-backed file listing shared by literal search and the audit scan. `git ls-files -co
// --exclude-standard` lists tracked + untracked files with .gitignore honoured, in a single call;
// nested repos / submodules (reported as directories) are recursed. Returns null outside a git
// repo so callers fall back to their own directory walk.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { debugNote } from './search-debug.js';

const MAX_NESTED_DEPTH = 4;

// Never-useful trees even when git lists them (worktree copies, the chemx index).
export const GIT_LISTING_SKIP = new Set(['.git', '.claude', '.chemx']);

const toPosix = (p) => p.split(path.sep).join('/');

const isSkippedPath = (relPath) => relPath.split('/').some((segment) => GIT_LISTING_SKIP.has(segment));

// includeIgnored is the opt-in seam for searching git-ignored paths explicitly (task #1959).
const lsFilesArgs = ({ includeIgnored }) => {
  const base = ['ls-files', '-z', '-co'];
  return includeIgnored ? base : [...base, '--exclude-standard'];
};

const gitLsFiles = (dir, options) => {
  const res = spawnSync('git', ['-C', dir, ...lsFilesArgs(options)], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const isGitListing = res.status === 0;
  return isGitListing ? res.stdout.split('\0').filter(Boolean) : null;
};

// 'dir' = real directory (nested repo / submodule), 'link' = symlink to a directory (never followed:
// it would double-count aliased source and loop on cycles), 'file' = anything else.
const classifyEntry = (abs) => {
  try {
    const isSymlink = fs.lstatSync(abs).isSymbolicLink();
    if (isSymlink) return fs.statSync(abs).isDirectory() ? 'link' : 'file';
    return fs.statSync(abs).isDirectory() ? 'dir' : 'file';
  } catch (err) {
    debugNote.warn(`stat ${abs}`, err);
    return 'file';
  }
};

const collect = (dir, root, out, options, depth) => {
  const entries = gitLsFiles(dir, options);
  const hasListing = Array.isArray(entries);
  if (!hasListing) return false;
  for (const entry of entries) {
    const cleaned = entry.replace(/\/$/, '');
    const isSkippedEntry = isSkippedPath(cleaned);
    if (isSkippedEntry) continue;
    const abs = path.join(dir, cleaned);
    const kind = classifyEntry(abs);
    const isLinkedDir = kind === 'link';
    if (isLinkedDir) continue;
    const isNestedRepo = kind === 'dir';
    const canRecurse = isNestedRepo && depth < MAX_NESTED_DEPTH;
    if (canRecurse) collect(abs, root, out, options, depth + 1);
    if (!isNestedRepo) out.push(toPosix(path.relative(root, abs)));
  }
  return true;
};

/** Files under `root` as posix paths relative to `root`, or null when `root` is not in a git repo. */
export const listGitFiles = (root, { includeIgnored = false } = {}) => {
  const out = [];
  const usedGit = collect(root, root, out, { includeIgnored }, 0);
  return usedGit ? Array.from(new Set(out)) : null;
};
