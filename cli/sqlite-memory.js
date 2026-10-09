// SQLite in-memory targets (":memory:", "file::memory:", "file:x?mode=memory") are database
// identifiers, never directories. Callers that turn a cwd into a .chemx path must check this first.

const MEMORY_URI_PATTERN = /^file:.*[?&]mode=memory(&|$)/;

export const isSqliteMemoryTarget = (value) => {
  const isString = typeof value === 'string';
  if (!isString) return false;
  const isPlainMemory = value === ':memory:';
  const isMemoryUri = value.startsWith('file::memory:') || MEMORY_URI_PATTERN.test(value);
  return isPlainMemory || isMemoryUri;
};

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
