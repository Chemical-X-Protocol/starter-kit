// The one project-root resolver for MCP calls and wrappers.
// Order: explicit projectRoot > MCP roots > server dir > CHEMX_PROJECT_ROOT
// > boot dir with a .chemx/.chemxrc marker. Anything else is refused, never guessed.
// A target path never picks the root (that let any package.json ancestor, even $HOME, become one).
import fs from 'node:fs';
import path from 'node:path';
import { LOADED_VERSION } from './server-info.js';
import { findChemxDir } from '../audit/chemx-dir.js';

const CHEMX_MARKERS = ['.chemxrc', '.chemxrc.json', '.chemx'];
const PROJECT_MARKERS = [...CHEMX_MARKERS, 'package.json', '.git'];

const hasAnyMarker = (dir, markers) => markers.some((m) => fs.existsSync(path.join(dir, m)));

export const isExistingDir = (p) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory();

export const hasChemxMarker = (dir) => hasAnyMarker(dir, CHEMX_MARKERS);

export const looksLikeProject = (dir) => hasAnyMarker(dir, PROJECT_MARKERS);

export const isInsideDir = (root, target) => {
  const rel = path.relative(root, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

// realpath of the nearest existing ancestor plus the not-yet-existing tail, so a symlink is followed.
const realResolve = (target) => {
  const tail = [];
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    const isFilesystemRoot = parent === current;
    if (isFilesystemRoot) return target;
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...tail);
};

// Inside both lexically and after following symlinks: a link in the root cannot carry a path out of it.
export const resolveInsideRoot = (root, requested) => {
  const resolved = path.resolve(root, requested);
  const isInside = isInsideDir(root, resolved) && isInsideDir(realResolve(root), realResolve(resolved));
  return { requested, resolved, isInside };
};

const parseAllowedRoots =(env) => (env.CHEMX_MCP_ALLOWED_ROOTS || '').split(path.delimiter).filter((p) => path.isAbsolute(p));

// When the client sent MCP roots or the server was started with a dir, projectRoot may only narrow them.
const locateProjectRoot = (projectRoot, declaredRoots) => {
  const isUsableRoot = isExistingDir(projectRoot) && looksLikeProject(projectRoot);
  if (!isUsableRoot) return { ok: false, error: `projectRoot "${projectRoot}" must be an absolute path to an existing project directory (.chemxrc, .chemx, package.json or .git).` };
  const isBounded = declaredRoots.length === 0 || declaredRoots.some((root) => resolveInsideRoot(root, projectRoot).isInside);
  if (!isBounded) return { ok: false, error: `projectRoot "${projectRoot}" is outside the declared roots (${declaredRoots.join(', ')}).` };
  return { ok: true, root: projectRoot, rootSource: 'projectRoot' };
};

const locateRoot = ({ projectRoot, mcpRoots, serverRoot, envRoot, bootDir }) => {
  const hasProjectRoot = !(projectRoot === undefined || projectRoot === null);
  if (hasProjectRoot) return locateProjectRoot(projectRoot, [...mcpRoots, serverRoot].filter(Boolean));
  const hasMcpRoots = mcpRoots.length > 0;
  if (hasMcpRoots) return { ok: true, root: mcpRoots[0], rootSource: 'mcpRoots' };
  if (serverRoot) return { ok: true, root: serverRoot, rootSource: 'declared' };
  if (envRoot) return { ok: true, root: envRoot, rootSource: 'env' };
  if (bootDir) return { ok: true, root: bootDir, rootSource: 'boot' };
  return { ok: false, error: 'No project root: pass projectRoot, start the server with a directory, set CHEMX_PROJECT_ROOT, or start it inside a project with .chemxrc/.chemx.' };
};

export const resolveContext = ({ cwd = null, projectRoot = null, mcpRoots = [], serverRoot = null, env = process.env } = {}) => {
  const envRoot = isExistingDir(env.CHEMX_PROJECT_ROOT) ? env.CHEMX_PROJECT_ROOT : null;
  const bootDir = cwd && hasChemxMarker(cwd) ? cwd : null;
  const located = locateRoot({ projectRoot, mcpRoots, serverRoot, envRoot, bootDir });
  const hasLocateFailed = !located.ok;
  if (hasLocateFailed) return located;
  const allowedRoots = parseAllowedRoots(env);
  const isPinned = allowedRoots.length > 0;
  const isAllowed = !isPinned || allowedRoots.some((allowed) => isInsideDir(allowed, located.root));
  if (!isAllowed) return { ok: false, error: `Root "${located.root}" is outside CHEMX_MCP_ALLOWED_ROOTS.` };
  // dbPath reports where the index layer will really open the db (it walks up to an existing .chemx).
  return { ...located, dbPath: path.join(findChemxDir(located.root), 'index.db'), version: LOADED_VERSION };
};
