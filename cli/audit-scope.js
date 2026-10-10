import fs from 'node:fs';
import path from 'node:path';
import { findAndLoadConfigFile } from './config/loader.js';
import { readWorkspaceGlobs, listWorkspacePackages } from './workspace.js';

const isDirectory = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

export const toRelDir = (projectRoot, dir) => path.relative(projectRoot, dir).split(path.sep).join('/') || '.';

const scopeFromPath = (projectRoot, requested, source) => {
  const dir = path.resolve(projectRoot, requested);
  const isMissing = !isDirectory(dir);
  if (isMissing) {
    const origin = source === 'config' ? 'Configured scope' : 'Audit directory';
    return { ok: false, reason: 'missing', message: `${origin} "${requested}" does not exist (resolved to ${dir}).`, candidates: [] };
  }
  return { ok: true, dir, relDir: toRelDir(projectRoot, dir), source };
};

// The `scope` key of .chemx/config.json (or chemx.config), or null. Shared with project-scope.js.
export const readConfiguredScope = (projectRoot) => {
  const scope = findAndLoadConfigFile(projectRoot).raw?.scope;
  const isUsable = typeof scope === 'string' && scope.length > 0;
  return isUsable ? scope : null;
};

// Submodule paths declared in .gitmodules (posix, root-relative); [] when there is none.
const submodulePaths = (projectRoot) => {
  try {
    const text = fs.readFileSync(path.join(projectRoot, '.gitmodules'), 'utf8');
    return [...text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => m[1]);
  } catch { // chemx-allow: best-effort a missing .gitmodules means no submodules
    return [];
  }
};

// At a workspace root the packages and submodules own their audits. Returns the root's own
// src/ plus what was left out, or null (the scope stays the whole root) without packages or src/.
const workspaceRootScope = (projectRoot) => {
  const globs = readWorkspaceGlobs(projectRoot);
  const packages = globs ? listWorkspacePackages(projectRoot, globs) : [];
  const srcDir = path.join(projectRoot, 'src');
  const isNarrowable = packages.length > 0 && isDirectory(srcDir);
  if (!isNarrowable) return null;
  const excluded = [...new Set([...packages.map((pkg) => pkg.rel), ...submodulePaths(projectRoot)])].sort();
  return { ok: true, dir: srcDir, relDir: 'src', source: 'workspace-root', excluded };
};

// narrowWorkspaceRoot: with no explicit dir or configured scope, a workspace root audits only its
// own src/ and reports the excluded package and submodule dirs.
export const resolveAuditScope = ({ projectRoot, explicitDir = null, narrowWorkspaceRoot = false }) => {
  if (explicitDir) return scopeFromPath(projectRoot, explicitDir, 'explicit');

  const configuredScope = readConfiguredScope(projectRoot);
  if (configuredScope) return scopeFromPath(projectRoot, configuredScope, 'config');

  const narrowed = narrowWorkspaceRoot ? workspaceRootScope(projectRoot) : null;
  if (narrowed) return narrowed;

  return { ok: true, dir: projectRoot, relDir: '.', source: 'root' };
};
