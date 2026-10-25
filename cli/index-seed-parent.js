/**
 * Chemical X Protocol: where a linked worktree's parent index lives (#6769, K8b).
 * A linked worktree has a `.git` FILE, `gitdir: <main>/.git/worktrees/<name>`. That directory holds
 * `commondir`, the repository's common git dir relative to it, whose parent is the main checkout; the
 * seed source is that checkout's `.chemx/index.db`. Plain file reads, no git spawn: the answer is asked
 * on every sync of an empty worktree index, and a fabricated layout is enough to spec it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chemxDbPathFor } from './sqlite-memory.js';
import { debugNote } from './search-debug.js';

const GITDIR_POINTER = /^gitdir:\s*(.+?)\s*$/m;
const WORKTREES_SEGMENT = /[\\/]worktrees[\\/][^\\/]+[\\/]?$/;

const none = (reason) => ({ status: 'none', reason });

const statOrNull = (target) => {
  try {
    return fs.statSync(target, { throwIfNoEntry: false }) ?? null;
  } catch (err) {
    debugNote.warn(`stat ${target}`, err);
    return null;
  }
};

const readTextOrNull = (file) => {
  const isFile = statOrNull(file)?.isFile() === true;
  if (!isFile) return null;
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (err) {
    debugNote.warn(`read ${file}`, err);
    return null;
  }
};

// `commondir` names the common git dir relative to the worktree's gitdir (usually `../..`). Without the
// file, the `<common>/worktrees/<name>` layout itself names it.
const resolveCommonDir = (gitDir) => {
  const commondir = readTextOrNull(path.join(gitDir, 'commondir'));
  const hasCommondir = commondir !== null && commondir.trim() !== '';
  if (hasCommondir) return path.resolve(gitDir, commondir.trim());
  const isWorktreeLayout = WORKTREES_SEGMENT.test(gitDir);
  return isWorktreeLayout ? path.dirname(path.dirname(gitDir)) : null;
};

/**
 * @param {string} root The directory whose `.chemx` the index db lives in.
 * @returns {{ status: 'found', mainRoot: string, dbPath: string } | { status: 'none', reason: string }}
 */
export const locateParentIndex = (root) => {
  const isDirectory = typeof root === 'string' && statOrNull(root)?.isDirectory() === true;
  if (!isDirectory) return none('not a directory');
  const pointerFile = path.join(root, '.git');
  const pointerText = readTextOrNull(pointerFile);
  const isLinkedWorktree = pointerText !== null;
  if (!isLinkedWorktree) return none('not a linked worktree (.git is a directory or missing)');
  const pointer = pointerText.match(GITDIR_POINTER)?.[1];
  const hasPointer = Boolean(pointer);
  if (!hasPointer) return none(`${pointerFile} has no gitdir pointer`);
  const gitDir = path.resolve(root, pointer);
  const commonDir = resolveCommonDir(gitDir);
  const hasCommonDir = commonDir !== null;
  if (!hasCommonDir) return none(`${gitDir} is not a worktree gitdir (no commondir)`);
  const mainRoot = path.dirname(commonDir);
  const dbPath = chemxDbPathFor(mainRoot);
  const hasParentDb = dbPath !== null && statOrNull(dbPath)?.isFile() === true;
  if (!hasParentDb) return none(`main checkout ${mainRoot} has no index (${dbPath})`);
  return { status: 'found', mainRoot, dbPath };
};
