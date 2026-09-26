import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves a target path against a base directory and ensures it does not escape the boundary.
 *
 * @param {string} targetPath File or directory path to validate.
 * @param {string} [baseDir=process.cwd()] Allowed root boundary directory.
 * @returns {string} Fully resolved, validated path within baseDir.
 * @throws {Error} If path contains null bytes, attempts traversal, or escapes baseDir.
 */
export const resolveSafePath = (targetPath, baseDir = process.cwd()) => {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('A valid file path string is required.');
  }

  if (targetPath.includes('\0')) {
    throw new Error('Null byte detected in path.');
  }

  const realBase = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : path.resolve(baseDir);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(realBase, targetPath);

  const relLexical = path.relative(realBase, resolvedTarget);
  const isLexicalEscape = relLexical.startsWith('..') || path.isAbsolute(relLexical);

  if (isLexicalEscape) {
    throw new Error(`Path traversal rejected: "${targetPath}" is outside allowed workspace root "${realBase}".`);
  }

  if (fs.existsSync(resolvedTarget)) {
    const realTarget = fs.realpathSync(resolvedTarget);
    const relReal = path.relative(realBase, realTarget);
    const isSymlinkEscape = relReal.startsWith('..') || path.isAbsolute(relReal);
    if (isSymlinkEscape) {
      throw new Error(`Path traversal rejected: "${targetPath}" resolves outside allowed workspace root via symlink.`);
    }
    return realTarget;
  }

  return resolvedTarget;
};

/**
 * Checks whether a target path attempts traversal or escapes the boundary.
 *
 * @param {string} targetPath Path to inspect.
 * @param {string} [baseDir=process.cwd()] Boundary directory.
 * @returns {boolean} True if the path escapes baseDir or is invalid, false otherwise.
 */
export const isPathTraversal = (targetPath, baseDir = process.cwd()) => {
  try {
    const resolved = resolveSafePath(targetPath, baseDir);
    const realBase = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : path.resolve(baseDir);
    const rel = path.relative(realBase, resolved);
    if (rel === '') return true;
    return false;
  } catch {
    return true;
  }
};
