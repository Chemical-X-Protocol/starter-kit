/**
 * Chemical X Protocol: the coordination root (#2488).
 * Team tables (tasks, comments, feed, DMs, agents, leases, lock queue, projects) belong in one db per
 * monorepo, <root>/.chemx/index.db, where root is, from the start directory:
 *   1. the outermost git superproject, climbing only through registered submodules (.gitmodules
 *      path or a .git/modules pointer) and from a linked worktree to its main checkout; else
 *   2. the outermost workspace root (pnpm-workspace.yaml or package.json workspaces) inside the
 *      nearest checkout; else
 *   3. the package itself: the nearest checkout, else the first dir on the way up with a project
 *      marker (.git, package.json, .chemxrc) or an existing .chemx/index.db (the dir the code index
 *      would use too), else the start dir.
 * No walk climbs into the OS temp dir, its ancestors or the filesystem root, and a root that lands
 * there is refused (#2570): a stray /tmp/.chemx never captures a temp project.
 * CHEMX_PROJECT_ROOT and an MCP projectRoot only choose the start directory; they never move the
 * root. The code index keeps resolving per project (search-schema.js); package scoping of the
 * index is part B of #2488.
 * A spec process (node --test sets NODE_TEST_CONTEXT) is refused any root outside the OS temp dir,
 * so specs never resolve a real db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkspaceGlobs } from '../workspace.js';
import { hasProjectMarker, isForbiddenRoot, forbiddenRootRefusal } from '../project-markers.js';

const realDir = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

export const ancestorsOf = (startDir) => {
  const dirs = [];
  let dir = path.resolve(startDir);
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    const isTop = parent === dir;
    if (isTop) return dirs;
    dir = parent;
  }
};

export const isInsideOrEqual = (outer, inner) => {
  const rel = path.relative(outer, inner);
  const isOutside = rel.startsWith('..') || path.isAbsolute(rel);
  return !isOutside;
};

// The ancestors a root search may visit: never the temp dir, its ancestors or the filesystem root.
const searchableAncestors = (startDir) => ancestorsOf(startDir).filter((dir) => !isForbiddenRoot(dir));

const hasGit = (dir) => fs.existsSync(path.join(dir, '.git'));
const nearestCheckout = (startDir) => searchableAncestors(startDir).find(hasGit) ?? null;

// The gitdir a `.git` FILE points at (submodule or linked worktree), or null for a real .git dir.
const readGitPointer = (dir) => {
  try {
    const gitPath = path.join(dir, '.git');
    const isPointerFile = fs.statSync(gitPath).isFile();
    const match = isPointerFile ? /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitPath, 'utf-8')) : null;
    return match ? path.resolve(dir, match[1].trim()) : null;
  } catch {
    return null;
  }
};

export const listedSubmodulePaths = (dir) => {
  try {
    const text = fs.readFileSync(path.join(dir, '.gitmodules'), 'utf-8');
    return [...text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => match[1].replace(/\\/g, '/'));
  } catch {
    return [];
  }
};

const WORKTREE_POINTER = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/;

// A linked worktree coordinates with its main checkout: <main>/.git/worktrees/<name> -> <main>.
const worktreeMain = (checkout) => {
  const pointer = readGitPointer(checkout) || '';
  const match = WORKTREE_POINTER.exec(pointer);
  return match ? match[1] : null;
};

const toPosix = (p) => p.split(path.sep).join('/');

// The checkout that registers `checkout` as a submodule, or null. An unrelated repo above (a
// dotfiles repo in $HOME) is never a superproject.
const superprojectOf = (checkout) => {
  const parent = path.dirname(checkout);
  const outer = parent === checkout ? null : nearestCheckout(parent);
  if (!outer) return null;
  const isListed = listedSubmodulePaths(outer).includes(toPosix(path.relative(outer, checkout)));
  const pointer = readGitPointer(checkout) || '';
  const isAbsorbed = pointer.startsWith(path.join(outer, '.git', 'modules') + path.sep);
  const isSubmodule = isListed || isAbsorbed;
  return isSubmodule ? outer : null;
};

const outermostSuperproject = (checkout) => {
  let current = worktreeMain(checkout) ?? checkout;
  let outer = superprojectOf(current);
  while (outer) {
    current = outer;
    outer = superprojectOf(current);
  }
  return current;
};

const isWorkspaceRoot = (dir) => Boolean(readWorkspaceGlobs(dir));

// Outermost workspace root among the ancestors, never above the nearest checkout's boundary.
const outermostWorkspace = (startDir, boundary) => {
  const candidates = searchableAncestors(startDir).filter((dir) => !boundary || isInsideOrEqual(boundary, dir));
  return candidates.filter(isWorkspaceRoot).pop() ?? null;
};

const isProjectStop = (dir) => hasProjectMarker(dir) || fs.existsSync(path.join(dir, '.chemx', 'index.db'));
const firstMarker = (startDir) => searchableAncestors(startDir).find(isProjectStop) ?? null;

const locateRoot = (startDir) => {
  const checkout = nearestCheckout(startDir);
  const superproject = checkout ? outermostSuperproject(checkout) : null;
  const hasSuperproject = Boolean(superproject) && superproject !== checkout;
  if (hasSuperproject) return { root: superproject, mode: 'superproject' };
  const workspace = outermostWorkspace(startDir, superproject);
  if (workspace) return { root: workspace, mode: 'workspace' };
  const own = superproject || firstMarker(startDir) || path.resolve(startDir);
  return { root: own, mode: 'standalone' };
};

export const isSpecProcess = (env = process.env) => Boolean(env.NODE_TEST_CONTEXT);

const specRefusal = (root, env) => {
  const isSpec = isSpecProcess(env);
  const isTemp = isInsideOrEqual(realDir(os.tmpdir()), realDir(root));
  const isRefused = isSpec && !isTemp;
  return isRefused ? `spec process refused the coordination db under ${root}: specs must build their project in a temp dir` : null;
};

/**
 * Why no team db may be opened at root, or null. Every opener of team rows asks this (#2581):
 * the temp dir and the filesystem root are never a root, and a spec process (node --test) never
 * opens a db outside the OS temp dir, whichever path it took to get there.
 */
export const teamDbRefusal = (root, env = process.env) => forbiddenRootRefusal(root) || specRefusal(root, env);

/**
 * @param {string} startDir Where the caller runs (cwd, MCP projectRoot, hook root).
 * @param {{ env?: object }} [options]
 * @returns {{ root: string, mode: 'superproject'|'workspace'|'standalone', refused: string|null }}
 */
export const resolveCoordinationRoot = (startDir = process.cwd(), options = {}) => {
  const env = options.env || process.env;
  const located = locateRoot(realDir(startDir));
  const root = realDir(located.root);
  return { root, mode: located.mode, refused: teamDbRefusal(root, env) };
};
