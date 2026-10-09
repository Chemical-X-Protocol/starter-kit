/**
 * Chemical X Protocol: lease keys.
 * A lease is keyed by the file's path relative to the project root, never the
 * caller's cwd, so `lock a.js` from src/ and `lock src/a.js` from the root
 * name the same lease. Relative inputs resolve from the caller's cwd.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findChemxDir } from '../audit/history.js';
import { resolveSafePath } from '../path-scope.js';

const realDir = (dir) => (fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir));

const readDbLocation = (db) => {
  try {
    return [typeof db?.location === 'function' ? db.location() : null, null];
  } catch (err) {
    return [null, err]; // a closed handle has no location; fall back to the cwd
  }
};

// The project a db belongs to: the parent of its .chemx directory.
const projectRootOfDb = (db) => {
  const [loc] = readDbLocation(db);
  const isProjectDb = Boolean(loc) && loc !== ':memory:' && loc.includes('.chemx');
  return isProjectDb ? path.dirname(path.dirname(path.resolve(loc))) : null;
};

export const resolveLeaseScope = (db, options = {}) => {
  const dbRoot = projectRootOfDb(db);
  const from = options.cwd || dbRoot || process.cwd();
  const projectRoot = dbRoot || path.dirname(findChemxDir(from));
  return { from: realDir(from), projectRoot: realDir(projectRoot) };
};

/** Project-root-relative key for filePath, or null when it escapes the project. */
export const toLeaseKey = (filePath, scope) => {
  try {
    const absolute = path.resolve(scope.from, filePath);
    const key = path.relative(scope.projectRoot, resolveSafePath(absolute, scope.projectRoot));
    return key === '' ? null : key;
  } catch {
    return null;
  }
};
