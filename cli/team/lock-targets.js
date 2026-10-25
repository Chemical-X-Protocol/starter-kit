/**
 * Chemical X Protocol: which paths `chemx team lock` accepts (#6747).
 * A lease is keyed from the board's root (the project root of the team db, lease-key.js), so a path is
 * lockable when it names a file below that root, whichever directory below it the caller stands in:
 * an absolute path in a sibling repo or submodule works, and so does ../b/x.js. Anything outside the
 * root is refused, and so is the root itself or the caller's own directory (a directory is not a file).
 * `--root=<dir>` (or `--root <dir>`) runs a lock or unlock as if from <dir>: relative paths resolve from
 * it and the board is the one that directory belongs to.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { isPathTraversal, resolveSafePath } from '../path-scope.js';
import { resolveLeaseScope } from './lease-key.js';
import { owningRepo } from './coordination-repos.js';

const ROOT_FLAG_SUBCOMMANDS = ['lock', 'unlock'];

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false; // chemx-allow: best-effort a missing or unreadable path is simply not a directory
  }
};

/** Splits `--root=<dir>` and `--root <dir>` out of the words after a subcommand. */
export const extractRootFlag = (args) => {
  const rest = [];
  let root;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const isEquals = arg.startsWith('--root=');
    const isSpaced = arg === '--root';
    if (isEquals) root = arg.slice('--root='.length);
    if (isSpaced) root = args[i + 1] ?? '';
    if (isSpaced) i += 1;
    const isRootFlag = isEquals || isSpaced;
    if (!isRootFlag) rest.push(arg);
  }
  return { rest, root };
};

/**
 * Prepares a lock or unlock call: --root removed and applied as the directory to run from. Other
 * subcommands pass through untouched. (Value flags such as `--purpose "text"` are normalized later, by
 * team-flag-values.js, so the text is never read as one more path.)
 * @returns {{ args: string[], cwd: string } | { error: string, message: string }}
 */
export const scopeLockArgs = (rawArgs, cwd) => {
  const isLockCall = ROOT_FLAG_SUBCOMMANDS.includes(rawArgs[0]);
  if (!isLockCall) return { args: rawArgs, cwd };
  const { rest, root } = extractRootFlag(rawArgs.slice(1));
  const args = [rawArgs[0], ...rest];
  const hasRoot = root !== undefined;
  if (!hasRoot) return { args, cwd };
  const dir = path.resolve(cwd, root);
  const isUsable = root !== '' && isDirectory(dir);
  if (!isUsable) return { error: 'root_not_found', message: `--root ${root || '(empty)'} is not a directory (looked for ${dir})` };
  return { args, cwd: dir };
};

const outsideMessage = (boardRoot) => `outside the board root ${boardRoot} (a lock names a file below the root, not the root or the current directory)`;

/**
 * Whether file may be locked, released or checked from cwd.
 * @returns {{ absolute: string, repo?: string } | { error: 'path_traversal', message: string }}
 */
export const checkLockTarget = (db, file, cwd) => {
  const scope = resolveLeaseScope(db, { cwd });
  const absolute = path.resolve(scope.from, file);
  const isInsideCwd = !isPathTraversal(file, cwd);
  const isCwdItself = absolute === scope.from;
  const isInsideBoard = !isCwdItself && !isPathTraversal(absolute, scope.projectRoot);
  const isAccepted = isInsideCwd || isInsideBoard;
  if (!isAccepted) return { error: 'path_traversal', message: outsideMessage(scope.projectRoot) };
  const repo = owningRepo(scope.projectRoot, absolute);
  return repo === null ? { absolute } : { absolute, repo };
};

/** The symlink-resolved absolute path of an accepted target; throws as resolveSafePath does for a path outside the board root. */
export const resolveLockTarget = (db, file, cwd) => {
  const scope = resolveLeaseScope(db, { cwd });
  return resolveSafePath(path.resolve(scope.from, file), scope.projectRoot);
};

/**
 * A path with whitespace that does not exist is most likely an unsplit list of files (#2559): a shell
 * that passed "a.js b.js" as one word. Only that case is refused; other nonexistent paths (files about
 * to be created) still lock, and several paths are given as several arguments.
 */
export const checkPathList = (file, cwd) => {
  const hasSpace = /\s/.test(file);
  if (!hasSpace) return null;
  const isPresent = existsSync(path.resolve(cwd, file));
  if (isPresent) return null;
  return { error: 'path_list', message: `"${file}" has spaces and does not exist, so it looks like several files joined together; pass one argument per path (chemx team lock a.js b.js; in zsh expand a variable with \${=files})` };
};
