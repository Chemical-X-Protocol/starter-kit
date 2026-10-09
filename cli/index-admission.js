// May a single file with no index row be added to the index? (#2552)
// The same rules the scope scan applies (search-scan.js), checked for one path without listing the
// repo: a source file, inside the project scope or a scope the index holds, not under a generated or
// vendored dir, not matched by a config `exclude` glob, and not ignored by git. A git-ignored file is
// indexed only through an explicit --dir (opt-in), never by reading it.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isSourceFile } from './languages.js';
import { isIgnoredDir } from './search-scan.js';
import { findAndLoadConfigFile } from './config/loader.js';
import { isScopeCovered, mergeScopeKeys, resolveDefaultScopeDir } from './search-root.js';

const isOutsideRoot = (relPath) => relPath === '' || relPath === '..' || relPath.startsWith('../') || path.isAbsolute(relPath);

const isUnderIgnoredDir = (relPath) => {
  const dirs = relPath.split('/').slice(0, -1);
  return dirs.some((name, i) => isIgnoredDir(name, i === 0 ? '' : dirs.slice(0, i).join('/')));
};

const isExcludedByConfig = (root, relPath) => {
  const patterns = findAndLoadConfigFile(root)?.raw?.exclude;
  const hasPatterns = Array.isArray(patterns);
  return hasPatterns && patterns.some((pattern) => path.matchesGlob(relPath, pattern));
};

// status 0: ignored; 1: not ignored; anything else (no git, not a repo): treated as not ignored.
const isGitIgnored = (root, relPath) => spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', relPath], { stdio: 'ignore' }).status === 0;

/** Returns null when relPath may be indexed, else the reason it is not. */
export const whyNotIndexable = (root, relPath, heldKey) => {
  if (isOutsideRoot(relPath)) return 'outside the project root';
  const isSource = isSourceFile(path.basename(relPath));
  if (!isSource) return 'not a source file the index parses';
  const coveringKey = mergeScopeKeys(heldKey || '', [resolveDefaultScopeDir(root)]);
  const isCovered = isScopeCovered([relPath], coveringKey);
  if (!isCovered) return `outside the index scope (${coveringKey})`;
  if (isUnderIgnoredDir(relPath)) return 'under a generated or vendored dir';
  if (isExcludedByConfig(root, relPath)) return 'matched by a config exclude glob';
  if (isGitIgnored(root, relPath)) return 'ignored by git (pass its dir with --dir to opt in)';
  return null;
};
