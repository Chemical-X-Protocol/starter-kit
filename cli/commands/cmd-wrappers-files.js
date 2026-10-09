// chemx f / chemx ls: path finder over tracked files (submodules included) with glob or substring filters.
import fs from 'node:fs';
import path from 'node:path';
import { runGit, emitWrapperResult } from './cmd-wrappers-git.js';

const MAX_LISTED = 100;
const WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const GLOB_CHARS = /[*?]/;

const escapeRegExp = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export const globToRegExp = (glob) => {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    const isDoubleStar = char === '*' && glob[i + 1] === '*';
    if (isDoubleStar) {
      const isDirPrefix = glob[i + 2] === '/';
      source += isDirPrefix ? '(?:.*/)?' : '.*';
      i += isDirPrefix ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
};

// A glob without a slash matches the basename (like .gitignore); otherwise the whole path.
export const createPathMatcher = (filter) => {
  const isGlob = GLOB_CHARS.test(filter);
  if (!isGlob) {
    const needle = filter.toLowerCase();
    return { kind: 'substring', matches: (file) => file.toLowerCase().includes(needle) };
  }
  const pattern = globToRegExp(filter);
  const isPathGlob = filter.includes('/');
  return { kind: 'glob', matches: (file) => pattern.test(isPathGlob ? file : path.posix.basename(file)) };
};

const walkFiles = (root, rel = '', out = []) => {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const isSkipped = entry.name.startsWith('.') || WALK_SKIP.has(entry.name);
    if (isSkipped) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkFiles(root, child, out);
    else out.push(child);
  }
  return out;
};

const listTrackedFiles = (cwd) => {
  const tracked = runGit(['ls-files', '--cached', '--recurse-submodules'], cwd);
  const isGitRepo = tracked.code === 0;
  if (!isGitRepo) return { files: walkFiles(cwd), source: 'directory walk (not a git repository)' };
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], cwd);
  const files = [...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(Boolean);
  return { files: [...new Set(files)], source: 'git ls-files incl. submodules' };
};

export const runFiles = async (rawArgs = [], isCli = true, cwd = process.cwd()) => {
  const filter = rawArgs.filter((a) => a !== 'f' && a !== 'ls')[0] || null;
  let listing;
  try {
    listing = listTrackedFiles(cwd);
  } catch (err) {
    return emitWrapperResult({ output: '', code: 1, error: `Failed to list files in ${cwd}: ${err.message}` }, isCli);
  }
  const matcher = filter ? createPathMatcher(filter) : null;
  const files = matcher ? listing.files.filter(matcher.matches) : listing.files;
  const isEmpty = files.length === 0;
  if (isEmpty) {
    const what = matcher ? `no files matched "${filter}" (${matcher.kind} match over ${listing.files.length} files from ${listing.source})` : `no files found (${listing.source})`;
    return emitWrapperResult({ output: '', code: 1, error: what }, isCli);
  }
  const overflow = files.length > MAX_LISTED ? `// [${files.length - MAX_LISTED} additional files omitted. Refine filter with chemx f <glob|substring>]\n` : '';
  return emitWrapperResult({ output: `${files.slice(0, MAX_LISTED).join('\n')}\n${overflow}`, code: 0 }, isCli);
};
