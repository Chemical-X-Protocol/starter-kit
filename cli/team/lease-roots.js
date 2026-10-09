/**
 * Chemical X Protocol: where leases for a path can live.
 * A lease row sits in the .chemx/index.db of the project that owns the file, keyed by the path
 * relative to that project root. Running from a subdirectory or a sub-package must still see a
 * lease held in an ancestor project, so lookups walk every ancestor that has a db.
 */
import fs from 'node:fs';
import path from 'node:path';

const hasLockDb = (dir) => fs.existsSync(path.join(dir, '.chemx', 'index.db'));

/** Every ancestor of startDir (inclusive) that has a .chemx/index.db, nearest first. */
export const ancestorLockRoots = (startDir) => {
  const roots = [];
  let dir = path.resolve(startDir);
  while (true) {
    if (hasLockDb(dir)) roots.push(dir);
    const parent = path.dirname(dir);
    const isTop = parent === dir;
    if (isTop) break;
    dir = parent;
  }
  return roots;
};

/** The workspace root plus every ancestor of the file with a db (same rule as edit-locks.js). */
export const lockRoots = (root, absPath) => {
  const roots = [root];
  for (const dir of ancestorLockRoots(path.dirname(absPath))) {
    const isNewRoot = !roots.includes(dir);
    if (isNewRoot) roots.push(dir);
  }
  return roots;
};

/** Keys a lease on absPath can carry in lockRoot's db: root-relative, and the legacy cwd-relative key. */
export const leaseKeys = (lockRoot, absPath, root) => {
  const keys = [path.relative(lockRoot, absPath), path.relative(root, absPath)];
  const isInside = (key) => key !== '' && !key.startsWith('..') && !path.isAbsolute(key);
  return keys.filter(isInside);
};
