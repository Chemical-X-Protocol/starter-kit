/**
 * Chemical X Protocol: task targets are stored relative to their owning repo (#2488, #2506).
 * A target typed relative to the caller's cwd (or absolute) is split into { repo, path } against
 * the team db's root. A target that resolves outside that root is refused, never stored as ../.
 * Readers turn a stored (repo, target_path) back into an absolute path or a root-relative key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toRepoPath, repoDir, rootRelativePath } from './coordination-repos.js';

const realDir = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

/**
 * @param {{ root: string, cwd: string, target: string }} input
 * @returns {{ repo: string, path: string } | { error: string }}
 */
export const normalizeTaskTarget = ({ root, cwd, target }) => {
  const hasTarget = typeof target === 'string' && target.trim() !== '';
  if (!hasTarget) return { error: 'target path is empty' };
  const absolute = path.resolve(realDir(cwd || root), target);
  const split = toRepoPath(realDir(root), absolute);
  const isOutside = Boolean(split.error);
  if (isOutside) return { error: `Refusing target ${target}: it resolves to ${absolute}, outside ${root}, the root of this team db. Run the command from the package that owns the file.` };
  const isRepoItself = split.path === '';
  if (isRepoItself) return { error: `Refusing target ${target}: it names the package directory ${split.repo}, not a file in it.` };
  return split;
};

/** Absolute path of a task's target, or null when it has none. */
export const taskTargetAbsolute = (root, task) => {
  const hasTarget = Boolean(task?.target_path);
  if (!hasTarget) return null;
  const isAbsolute = path.isAbsolute(task.target_path);
  return isAbsolute ? task.target_path : path.resolve(repoDir(root, task.repo), task.target_path);
};

/** Root-relative posix key of a task's target (the lease key), or null when it has none. */
export const taskTargetKey = (task) => {
  const hasTarget = Boolean(task?.target_path);
  return hasTarget ? rootRelativePath(task.repo, task.target_path) : null;
};

/** True when a stored target climbs out of its repo (rows written before #2506). */
export const isEscapingTarget = (target) => {
  const normalized = path.posix.normalize(String(target || '').replace(/\\/g, '/'));
  return normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized);
};
