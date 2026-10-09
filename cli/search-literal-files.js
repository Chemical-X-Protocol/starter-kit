// File listing for the JS literal-search engine: what `rg` would search. Git repos use
// `git ls-files` (tracked + untracked, .gitignore honoured) and recurse into submodules;
// elsewhere a walk skips generated dirs. Hidden paths are skipped unless asked for.
import fs from 'node:fs';
import path from 'node:path';
import { ANY_DEPTH_IGNORED_DIRS } from './search-scan.js';
import { debugNote } from './search-debug.js';
import { listGitFiles } from './git-file-listing.js';

const toPosix = (p) => p.split(path.sep).join('/');

const isHiddenPath = (relPath) => relPath.split('/').some((segment) => segment.startsWith('.') && segment.length > 1 && segment !== '..');

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
  const gitFiles = listGitFiles(root);
  const usedGit = Array.isArray(gitFiles);
  const files = usedGit ? gitFiles : [];
  if (!usedGit) walkFiles(root, root, files);
  const isWholeProject = scopeDirs.includes('.');
  const inScope = (rel) => isWholeProject || scopeDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const visible = (rel) => isHidden || !isHiddenPath(rel);
  const selected = Array.from(new Set(files)).filter((rel) => inScope(rel) && visible(rel)).sort();
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
