/**
 * Chemical X Protocol: which repo owns a path inside the coordination root (#2488).
 * A repo is a package path relative to the coordination root: '.', 'apps/youmeos',
 * 'apps/chemical-x/starter-kit'. The repos are the root itself, every registered git submodule
 * (recursively) and every workspace package of the root; the deepest one containing a path owns it.
 * Task targets are stored relative to their repo, so a ../ path never reaches the db.
 */
import path from 'node:path';
import { listWorkspacePackages } from '../workspace.js';
import { listedSubmodulePaths, isInsideOrEqual } from './coordination-root.js';

const toPosix = (p) => p.split(path.sep).join('/');
const repoCache = new Map();

const submoduleDirs = (dir, depth = 0) => {
  const isTooDeep = depth > 4;
  if (isTooDeep) return [];
  const direct = listedSubmodulePaths(dir).map((rel) => path.join(dir, rel));
  return [...direct, ...direct.flatMap((child) => submoduleDirs(child, depth + 1))];
};

const readRepoDirs = (root) => {
  try {
    const workspaceDirs = listWorkspacePackages(root).map((pkg) => pkg.dir);
    return [...new Set([...submoduleDirs(root), ...workspaceDirs])];
  } catch {
    return submoduleDirs(root);
  }
};

/** Absolute dirs of every repo below the root (the root itself excluded), cached per process. */
export const listRepoDirs = (root) => {
  const key = path.resolve(root);
  const cached = repoCache.get(key);
  if (cached) return cached;
  const dirs = readRepoDirs(key);
  repoCache.set(key, dirs);
  return dirs;
};

export const clearRepoCache = () => repoCache.clear();

/** The owning repo of absPath ('.' for the root itself), or null when absPath is outside the root. */
export const owningRepo = (root, absPath) => {
  const target = path.resolve(absPath);
  const isInside = isInsideOrEqual(root, target);
  if (!isInside) return null;
  const owners = listRepoDirs(root).filter((dir) => isInsideOrEqual(dir, target));
  const deepest = owners.sort((a, b) => b.length - a.length)[0];
  return deepest ? toPosix(path.relative(root, deepest)) : '.';
};

/** The absolute directory of a repo path. */
export const repoDir = (root, repo) => path.resolve(root, repo || '.');

/**
 * Splits an absolute path into { repo, path } with path relative to its repo (posix).
 * @returns {{ repo: string, path: string } | { error: string }}
 */
export const toRepoPath = (root, absPath) => {
  const repo = owningRepo(root, absPath);
  const isOutside = repo === null;
  if (isOutside) return { error: `${absPath} is outside the coordination root ${root}` };
  const rel = toPosix(path.relative(repoDir(root, repo), path.resolve(absPath)));
  return { repo, path: rel };
};

/** Root-relative posix path of a repo-relative target, used for lease keys and dispatch. */
export const rootRelativePath = (repo, target) => {
  const joined = path.posix.normalize(path.posix.join(repo || '.', String(target || '').replace(/\\/g, '/')));
  return joined === '.' ? '' : joined;
};
