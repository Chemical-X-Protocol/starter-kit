// The one project-root resolver for MCP calls and wrappers.
// Order: explicit projectRoot > MCP roots > server dir > CHEMX_PROJECT_ROOT
// > boot dir with a .chemx/.chemxrc marker. Anything else is refused, never guessed.
// A target path never picks the root (that let any package.json ancestor, even $HOME, become one).
import fs from 'node:fs';
import path from 'node:path';
import { LOADED_VERSION } from './server-info.js';
import { findChemxDir } from '../audit/history.js';

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

const parseAllowedRoots = (env) => (env.CHEMX_MCP_ALLOWED_ROOTS || '').split(path.delimiter).filter((p) => path.isAbsolute(p));

const locateRoot = ({ projectRoot, mcpRoots, serverRoot, envRoot, bootDir }) => {
  const hasProjectRoot = !(projectRoot === undefined || projectRoot === null);
  if (hasProjectRoot) {
    const isUsableRoot = isExistingDir(projectRoot) && looksLikeProject(projectRoot);
    if (isUsableRoot) return { ok: true, root: projectRoot, rootSource: 'projectRoot' };
    return { ok: false, error: `projectRoot "${projectRoot}" must be an absolute path to an existing project directory (.chemxrc, .chemx, package.json or .git).` };
  }
  if (mcpRoots.length > 0) return { ok: true, root: mcpRoots[0], rootSource: 'mcpRoots' };
  if (serverRoot) return { ok: true, root: serverRoot, rootSource: 'declared' };
  if (envRoot) return { ok: true, root: envRoot, rootSource: 'env' };
  if (bootDir) return { ok: true, root: bootDir, rootSource: 'boot' };
  return { ok: false, error: 'No project root: pass projectRoot, start the server with a directory, set CHEMX_PROJECT_ROOT, or start it inside a project with .chemxrc/.chemx.' };
};

export const resolveContext = ({ cwd = null, projectRoot = null, mcpRoots = [], serverRoot = null, env = process.env } = {}) => {
  const envRoot = isExistingDir(env.CHEMX_PROJECT_ROOT) ? env.CHEMX_PROJECT_ROOT : null;
  const bootDir = cwd && hasChemxMarker(cwd) ? cwd : null;
  const located = locateRoot({ projectRoot, mcpRoots, serverRoot, envRoot, bootDir });
  if (!located.ok) return located;
  const allowedRoots = parseAllowedRoots(env);
  const isPinned = allowedRoots.length > 0;
  const isAllowed = !isPinned || allowedRoots.some((allowed) => isInsideDir(allowed, located.root));
  if (!isAllowed) return { ok: false, error: `Root "${located.root}" is outside CHEMX_MCP_ALLOWED_ROOTS.` };
  // dbPath reports where the index layer will really open the db (it walks up to an existing .chemx).
  return { ...located, dbPath: path.join(findChemxDir(located.root), 'index.db'), version: LOADED_VERSION };
};
