// File listing for the JS literal-search engine: what `rg` would search. Git repos use
// `git ls-files` (tracked + untracked, .gitignore honoured) and recurse into submodules;
// elsewhere a walk skips generated dirs. Hidden paths are skipped unless asked for.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ANY_DEPTH_IGNORED_DIRS } from './search-scan.js';
import { debugNote } from './search-debug.js';

const toPosix = (p) => p.split(path.sep).join('/');

// Git already applies .gitignore; only never-useful trees are dropped (worktree copies, the index).
const GIT_LISTING_SKIP = new Set(['.git', '.claude', '.chemx']);

const isIgnoredPath = (relPath) => relPath.split('/').some((segment) => GIT_LISTING_SKIP.has(segment));

const isHiddenPath = (relPath) => relPath.split('/').some((segment) => segment.startsWith('.') && segment.length > 1 && segment !== '..');

const gitLsFiles = (dir) => {
  const res = spawnSync('git', ['-C', dir, 'ls-files', '-z', '-co', '--exclude-standard'], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const isGitListing = res.status === 0;
  return isGitListing ? res.stdout.split('\0').filter(Boolean) : null;
};

const isDirectory = (abs) => {
  try {
    return fs.statSync(abs).isDirectory();
  } catch (err) {
    debugNote.warn(`stat ${abs}`, err);
    return false;
  }
};

// Lists files under `dir` relative to `root`; gitlink / nested-repo entries are recursed.
const listGitFiles = (dir, root, out, depth = 0) => {
  const entries = gitLsFiles(dir);
  const hasListing = Array.isArray(entries);
  if (!hasListing) return false;
  for (const entry of entries) {
    const isIgnoredEntry = isIgnoredPath(entry.replace(/\/$/, ''));
    if (isIgnoredEntry) continue;
    const abs = path.join(dir, entry.replace(/\/$/, ''));
    const isNestedRepo = isDirectory(abs);
    const canRecurse = isNestedRepo && depth < 4;
    if (canRecurse) listGitFiles(abs, root, out, depth + 1);
    if (!isNestedRepo) out.push(toPosix(path.relative(root, abs)));
  }
  return true;
};

const walkFiles = (dir, root, out) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    debugNote.warn(`unreadable dir ${dir}`, err);
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const isSkippedDir = entry.isDirectory() && ANY_DEPTH_IGNORED_DIRS.has(entry.name);
    if (isSkippedDir) continue;
    if (entry.isDirectory()) walkFiles(abs, root, out);
    else if (entry.isFile()) out.push(toPosix(path.relative(root, abs)));
  }
};

export const listLiteralSearchFiles = (root, scopeDirs = ['.'], { isHidden = false } = {}) => {
  const files = [];
  const usedGit = listGitFiles(root, root, files);
  if (!usedGit) walkFiles(root, root, files);
  const isWholeProject = scopeDirs.includes('.');
  const inScope = (rel) => isWholeProject || scopeDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const visible = (rel) => isHidden || !isHiddenPath(rel);
  const selected = Array.from(new Set(files)).filter((rel) => inScope(rel) && visible(rel)).sort();
  return { files: selected, lister: usedGit ? 'git ls-files' : 'walk' };
};
