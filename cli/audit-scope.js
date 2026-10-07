import fs from 'node:fs';
import path from 'node:path';
import { findAndLoadConfigFile } from './config/loader.js';

export const SOURCE_ROOT_CANDIDATES = ['src', 'lib', 'app', 'cli', 'packages', 'blueprints'];

const isDirectory = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory();

const toRelDir = (projectRoot, dir) => path.relative(projectRoot, dir).split(path.sep).join('/') || '.';

const scopeFromPath = (projectRoot, requested, source) => {
  const dir = path.resolve(projectRoot, requested);
  const isMissing = !isDirectory(dir);
  if (isMissing) {
    const origin = source === 'config' ? 'Configured scope' : 'Audit directory';
    return { ok: false, reason: 'missing', message: `${origin} "${requested}" does not exist (resolved to ${dir}).`, candidates: [] };
  }
  return { ok: true, dir, relDir: toRelDir(projectRoot, dir), source };
};

const readConfiguredScope = (projectRoot) => {
  const scope = findAndLoadConfigFile(projectRoot).raw?.scope;
  const isUsable = typeof scope === 'string' && scope.length > 0;
  return isUsable ? scope : null;
};

export const resolveAuditScope = ({ projectRoot, explicitDir = null }) => {
  if (explicitDir) return scopeFromPath(projectRoot, explicitDir, 'explicit');

  const configuredScope = readConfiguredScope(projectRoot);
  if (configuredScope) return scopeFromPath(projectRoot, configuredScope, 'config');

  const candidates = SOURCE_ROOT_CANDIDATES.filter((name) => isDirectory(path.join(projectRoot, name))).sort();
  const isAmbiguous = candidates.length >= 2;
  if (isAmbiguous) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `Ambiguous audit scope: found ${candidates.join(', ')}. Pass --dir=<path> or set "scope" in .chemxrc.`,
      candidates
    };
  }
  return { ok: true, dir: projectRoot, relDir: '.', source: 'root' };
};
