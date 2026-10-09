// SQLite in-memory targets (":memory:", "file::memory:", "file:x?mode=memory") are database
// identifiers, never directories. Callers that turn a cwd into a .chemx path must check this first.

import path from 'node:path';

const MEMORY_URI_PATTERN = /^file:.*[?&]mode=memory(&|$)/;

export const isSqliteMemoryTarget = (value) => {
  const isString = typeof value === 'string';
  if (!isString) return false;
  const isPlainMemory = value === ':memory:';
  const isMemoryUri = value.startsWith('file::memory:') || MEMORY_URI_PATTERN.test(value);
  return isPlainMemory || isMemoryUri;
};

// A usable project root is a real path string. SQLite memory targets, empty values and
// non-strings are rejected so nothing can build `<cwd>/:memory:/.chemx`.
export const isUsableProjectRoot = (root) => {
  const isString = typeof root === 'string';
  const isEmpty = !isString || root.trim() === '';
  if (isEmpty) return false;
  return !isSqliteMemoryTarget(root);
};

// The one place a root becomes a `.chemx` path. Returns null when the root is not a directory
// (memory target), so callers skip filesystem work instead of creating `:memory:/.chemx`.
export const chemxPathFor = (root, ...segments) => {
  const isUsable = isUsableProjectRoot(root);
  if (!isUsable) return null;
  return path.join(root, '.chemx', ...segments);
};

export const chemxDbPathFor = (root) => chemxPathFor(root, 'index.db');

// A linked git worktree has a `.git` FILE pointing into `<repo>/.git/worktrees/<name>`.
// Its checkout is a different tree from the main one, so it must never share the main index.
export const isLinkedWorktreeRoot = (fs, path, dir) => {
  const gitPath = path.join(dir, '.git');
  try {
    const isGitFile = fs.statSync(gitPath).isFile();
    if (!isGitFile) return false;
    const pointer = fs.readFileSync(gitPath, 'utf-8');
    return /gitdir:.*[\\/]worktrees[\\/]/.test(pointer);
  } catch {
    return false;
  }
};
