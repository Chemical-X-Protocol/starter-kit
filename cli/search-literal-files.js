// File listing for the JS literal-search engine: what `rg` would search. Git repos use
// `git ls-files` (tracked + untracked, .gitignore honoured) and recurse into submodules;
// elsewhere a walk skips generated dirs. Dot-directories (.github, .claude, .chemxrc) are searched like
// any other path; only what git ignores stays out, plus the chemx index dir and Claude's worktree copies.
// --hidden (isHidden) lifts those ignores. The git store and dependency trees are never searched.
import fs from 'node:fs';
import path from 'node:path';
import { ANY_DEPTH_IGNORED_DIRS } from './search-scan.js';
import { debugNote } from './search-debug.js';
import { listGitFiles } from './git-file-listing.js';

const toPosix = (p) => p.split(path.sep).join('/');

// Never searched, even with --hidden: the git store, and dependency trees (110k of the 130k files a pnpm app lists
// once ignored paths are in, which made --hidden take minutes).
export const NEVER_SEARCHED_DIRS = ['.git', 'node_modules'];

const isNeverSearched = (relPath) => relPath.split('/').some((segment) => NEVER_SEARCHED_DIRS.includes(segment));

// Tool-generated trees: a copy of the repo under .claude/worktrees or the chemx index would bury the answer.
const isToolTree = (relPath) => {
  const segments = relPath.split('/');
  const isChemxDir = segments.includes('.chemx');
  const isWorktreeCopy = segments.some((segment, i) => segment === '.claude' && segments[i + 1] === 'worktrees');
  return isNeverSearched(relPath) || isChemxDir || isWorktreeCopy;
};

const walkFiles = (dir, root, out, isHidden) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    debugNote.warn(`unreadable dir ${dir}`, err);
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const isGeneratedDir = !isHidden && ANY_DEPTH_IGNORED_DIRS.has(entry.name);
    const isSkippedDir = entry.isDirectory() && (NEVER_SEARCHED_DIRS.includes(entry.name) || isGeneratedDir);
    if (isSkippedDir) continue;
    if (entry.isDirectory()) walkFiles(abs, root, out, isHidden);
    else if (entry.isFile()) out.push(toPosix(path.relative(root, abs)));
  }
};

export const listLiteralSearchFiles = (root, scopeDirs = ['.'], { isHidden = false } = {}) => {
  const gitFiles = listGitFiles(root, { includeIgnored: isHidden, isSkipped: isHidden ? isNeverSearched : isToolTree });
  const usedGit = Array.isArray(gitFiles);
  const files = usedGit ? gitFiles : [];
  if (!usedGit) walkFiles(root, root, files, isHidden);
  const isWholeProject = scopeDirs.includes('.');
  const inScope = (rel) => isWholeProject || scopeDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const selected = Array.from(new Set(files)).filter(inScope).sort();
  return { files: selected, lister: usedGit ? 'git ls-files' : 'walk' };
};

const SNIFF_BYTES = 8000;

// The same verdict the JS engine reaches by reading the file: 'large' over maxBytes, 'binary'
// with a NUL in the first 8000 bytes, else 'text' ('unreadable' when it cannot be opened).
export const classifySearchFile = (root, rel, maxBytes) => {
  let fd = null;
  try {
    const abs = path.join(root, rel);
    const isTooLarge = fs.statSync(abs).size > maxBytes;
    if (isTooLarge) return 'large';
    fd = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, read).includes(0) ? 'binary' : 'text';
  } catch (err) {
    debugNote.warn(`literal sniff ${rel}`, err);
    return 'unreadable';
  } finally {
    const isOpen = fd !== null;
    if (isOpen) fs.closeSync(fd);
  }
};
