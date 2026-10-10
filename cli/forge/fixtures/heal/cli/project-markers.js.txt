/**
 * Chemical X Protocol: where a walk for a project root may stop (#2570, #2581).
 * A project marker (.git, package.json, .chemxrc) ends an upward search. The filesystem root and
 * the OS temp dir (with its ancestors) are never a project root: a stray /tmp/.chemx or /.chemx
 * must not capture a temp project that has no marker of its own.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_MARKERS = Object.freeze(['.git', 'package.json', '.chemxrc']);

const realDir = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

export const hasProjectMarker = (dir) => PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));

/** True for the filesystem root, the OS temp dir and every ancestor of the temp dir. */
export const isForbiddenRoot = (dir) => {
  const resolved = realDir(dir);
  const isFsRoot = path.dirname(resolved) === resolved;
  const rel = path.relative(resolved, realDir(os.tmpdir()));
  const holdsTempDir = !rel.startsWith('..') && !path.isAbsolute(rel);
  return isFsRoot || holdsTempDir;
};

/** True when dir is the OS temp dir or inside it. */
export const isInsideTempDir = (dir) => {
  const rel = path.relative(realDir(os.tmpdir()), realDir(dir));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Text for a refused root, or null when dir may hold a .chemx. */
export const forbiddenRootRefusal = (dir) => {
  const isForbidden = isForbiddenRoot(dir);
  return isForbidden ? `chemx will not use ${dir} as a project root (it is the OS temp dir, an ancestor of it, or the filesystem root); run from a project directory` : null;
};
