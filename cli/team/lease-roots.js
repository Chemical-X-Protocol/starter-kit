/**
 * Chemical X Protocol: where leases for a path can live.
 * A lease row sits in a team db, keyed by the path relative to that db's root. Which dbs count comes
 * from the coordination resolver (#2581, coordination-target.js teamDbRootsFor): each package db
 * between the path and the coordination root that has not been merged, then the coordination db.
 * Running from a subdirectory or a sub-package still sees a lease held in the coordination db, and
 * no db outside the coordination root (a stray /tmp/.chemx, a parent checkout) is ever read.
 */
import path from 'node:path';
import { teamDbRootsFor } from './coordination-target.js';

/** Every team db root that can hold a lease for startDir (inclusive), nearest first. */
export const ancestorLockRoots = (startDir) => teamDbRootsFor(startDir);

/**
 * Every team db root that can hold a lease on the file (same rule as edit-locks.js). The caller's root
 * comes first only when the resolver lists it: a merged source db is never read, and a refused caller gets none.
 */
export const lockRoots = (root, absPath) => {
  const listed = teamDbRootsFor(path.dirname(absPath));
  const isOwnListed = listed.includes(root);
  return isOwnListed ? [root, ...listed.filter((dir) => dir !== root)] : listed;
};

/** Keys a lease on absPath can carry in lockRoot's db: root-relative, and the legacy cwd-relative key. */
export const leaseKeys = (lockRoot, absPath, root) => {
  const keys = [path.relative(lockRoot, absPath), path.relative(root, absPath)];
  const isInside = (key) => key !== '' && !key.startsWith('..') && !path.isAbsolute(key);
  return [...new Set(keys.filter(isInside))];
};
