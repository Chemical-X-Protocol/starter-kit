import fs from 'node:fs';
import path from 'node:path';
import { ruleTree } from './rules.js';

const validatePathTarget = (targetPath) => {
  const isMissing = !targetPath;
  const isNonString = typeof targetPath !== 'string';
  const gate = ruleTree({
    input: {
      invalidType: isMissing || isNonString,
      hasNullByte: () => targetPath.includes('\0')
    }
  }, { failFast: true });

  const hasValidationError = !gate.ok;
  if (hasValidationError) {
    const isNullByteFailure = gate.first === 'input.hasNullByte';
    if (isNullByteFailure) throw new Error('Null byte detected in path.');
    throw new Error('A valid file path string is required.');
  }
};

/**
 * Resolves a target path against a base directory and ensures it does not escape the boundary.
 *
 * @param {string} targetPath File or directory path to validate.
 * @param {string} [baseDir=process.cwd()] Allowed root boundary directory.
 * @returns {string} Fully resolved, validated path within baseDir.
 * @throws {Error} If path contains null bytes, attempts traversal, or escapes baseDir.
 */
export const resolveSafePath = (targetPath, baseDir = process.cwd()) => {
  validatePathTarget(targetPath);

  const realBase = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : path.resolve(baseDir);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(realBase, targetPath);

  const relLexical = path.relative(realBase, resolvedTarget);
  const isLexicalEscape = relLexical.startsWith('..') || path.isAbsolute(relLexical);

  if (isLexicalEscape) {
    throw new Error(`Path traversal rejected: "${targetPath}" resolves to "${resolvedTarget}", outside allowed workspace root "${realBase}".`);
  }

  const { existing, rest } = splitAtNearestExisting(resolvedTarget);
  const relExistingLexical = path.relative(realBase, existing);
  const isAncestorAboveBase = relExistingLexical.startsWith('..') || path.isAbsolute(relExistingLexical);
  if (isAncestorAboveBase) {
    return resolvedTarget;
  }

  let realExisting;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    throw new Error(`Path traversal rejected: "${targetPath}" passes through a dangling symlink.`);
  }
  const relReal = path.relative(realBase, realExisting);
  const isSymlinkEscape = relReal.startsWith('..') || path.isAbsolute(relReal);
  if (isSymlinkEscape) {
    throw new Error(`Path traversal rejected: "${targetPath}" resolves outside allowed workspace root via symlink.`);
  }

  return rest.length > 0 ? path.join(realExisting, ...rest) : realExisting;
};

/**
 * Walks up from a path to its nearest existing ancestor (the path itself when it exists).
 * A dangling symlink counts as existing, so realpath on it fails closed.
 *
 * @param {string} absPath Absolute path.
 * @returns {{ existing: string, rest: string[] }} Existing ancestor and the missing segments below it.
 */
const splitAtNearestExisting = (absPath) => {
  const rest = [];
  let current = absPath;
  const pathExists = (p) => {
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  };
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    const isFilesystemRoot = parent === current;
    if (isFilesystemRoot) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return { existing: current, rest };
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
    const isExactBaseMatch = rel === '';
    if (isExactBaseMatch) return true;
    return false;
  } catch {
    return true;
  }
};

const hasDotNetProject = (cwd) => {
  try {
    const rootEntries = fs.readdirSync(cwd, { withFileTypes: true });
    const hasSln = rootEntries.some((e) => e.isFile() && e.name.endsWith('.sln'));
    const hasRootCsproj = rootEntries.some((e) => e.isFile() && e.name.endsWith('.csproj'));
    const hasDotNetRootProject = hasSln || hasRootCsproj;
    if (hasDotNetRootProject) return true;

    return rootEntries.some((e) => {
      const isCandidateDir = e.isDirectory() && e.name !== 'src' && e.name !== 'node_modules' && !e.name.startsWith('.');
      if (!isCandidateDir) return false;
      const subPath = path.join(cwd, e.name);
      try {
        return fs.readdirSync(subPath).some((f) => f.endsWith('.csproj'));
      } catch (err) {
        const isDebugActive = Boolean(process.env.DEBUG);
        if (isDebugActive) process.stderr.write(`[debug] Read failed: ${err?.message}\n`);
        return false;
      }
    });
  } catch (err) {
    const isDebugActive = Boolean(process.env.DEBUG);
    if (isDebugActive) process.stderr.write(`[debug] Scan failed: ${err?.message}\n`);
    return false;
  }
};

export const resolveTargetDir = (customOrFlag = null, dirFlag = null, cwd = process.cwd()) => {
  const isCustomPath = Boolean(customOrFlag && !customOrFlag.startsWith('--dir='));
  if (isCustomPath) {
    return customOrFlag;
  }

  const effectiveFlag = dirFlag || (customOrFlag?.startsWith('--dir=') ? customOrFlag : null);
  const hasEffectiveFlag = Boolean(effectiveFlag);
  if (hasEffectiveFlag) {
    const [, flagValue] = effectiveFlag.split('=');
    const hasFlagValue = flagValue !== undefined;
    if (hasFlagValue) {
      return flagValue;
    }
  }

  if (hasDotNetProject(cwd)) {
    return '.';
  }

  const hasSrcDirectory = fs.existsSync(path.resolve(cwd, 'src'));
  if (hasSrcDirectory) {
    return 'src';
  }

  return '.';
};
