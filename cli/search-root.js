// One answer to "which project does this index describe, and which part of it".
// The root is the directory that holds the .chemx the db lives in; every indexed path is
// stored relative to it, whatever subdirectory chemx was started from.
import path from 'node:path';
import { findChemxDir } from './audit/chemx-dir.js';
import { resolveTargetDir } from './path-scope.js';

const toPosix = (p) => p.split(path.sep).join('/');

export const resolveIndexRoot = (cwd = process.cwd()) => path.dirname(findChemxDir(cwd));

const isOutsideRoot = (rel) => rel === '..' || rel.startsWith('../') || path.isAbsolute(rel);

// Turns user-supplied dirs (relative to cwd, or absolute) into root-relative scope dirs.
// Returns { scopeDirs, scopeKey, outside } where outside lists dirs that escape the root.
export const normalizeScope = (targetDirs, root, cwd = root) => {
  const list = Array.isArray(targetDirs) ? targetDirs : [targetDirs];
  const scopeDirs = [];
  const outside = [];
  for (const dir of list) {
    const isBlank = dir === null || dir === undefined || dir === '';
    const abs = isBlank ? path.resolve(cwd) : path.resolve(cwd, dir);
    const rel = toPosix(path.relative(root, abs)) || '.';
    if (isOutsideRoot(rel)) {
      outside.push(String(dir));
      continue;
    }
    scopeDirs.push(rel);
  }
  const unique = Array.from(new Set(scopeDirs)).sort();
  const hasWholeProject = unique.includes('.');
  const finalDirs = hasWholeProject ? ['.'] : unique;
  return { scopeDirs: finalDirs, scopeKey: finalDirs.join(','), outside };
};

// Default scope when no --dir is given: the project's own default (src/ or .), resolved
// from the root, never from the subdirectory the command happened to start in.
export const resolveDefaultScopeDir = (root) => resolveTargetDir(null, null, root);

export const isPathInScope = (relPath, scopeDirs) => scopeDirs.some((dir) => {
  const isWholeProject = dir === '.';
  return isWholeProject || relPath === dir || relPath.startsWith(`${dir}/`);
});

export const isScopeCovered = (scopeDirs, coveringKey) => {
  const hasCoveringKey = typeof coveringKey === 'string' && coveringKey.length > 0;
  if (!hasCoveringKey) return false;
  const coveringDirs = coveringKey.split(',');
  return scopeDirs.every((dir) => isPathInScope(dir, coveringDirs));
};

export const parseScopeKey = (key) => {
  const hasKey = typeof key === 'string' && key.length > 0;
  return hasKey ? key.split(',') : [];
};

// The index keeps every scope it has synced. Merging drops dirs another dir already covers,
// so 'src' + 'other' is 'other,src' and anything + '.' is '.'.
export const mergeScopeKeys = (storedKey, scopeDirs) => {
  const all = Array.from(new Set([...parseScopeKey(storedKey), ...scopeDirs])).sort();
  const isCoveredByAnother = (dir) => all.some((other) => other !== dir && isPathInScope(dir, [other]));
  return all.filter((dir) => !isCoveredByAnother(dir)).join(',');
};

// SQL predicate for "column is a path inside scopeDirs" (exact prefix, no LIKE wildcards).
export const scopeSqlFilter = (column, scopeDirs) => {
  const dirs = Array.isArray(scopeDirs) ? scopeDirs : [];
  const isUnscoped = dirs.length === 0 || dirs.includes('.');
  if (isUnscoped) return { sql: '1 = 1', params: [] };
  const clauses = dirs.map(() => `(${column} = ? OR substr(${column}, 1, ?) = ?)`);
  const params = dirs.flatMap((dir) => [dir, dir.length + 1, `${dir}/`]);
  return { sql: `(${clauses.join(' OR ')})`, params };
};

export const toRootRelative = (filePath, root, cwd = root) => {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return toPosix(path.relative(root, abs));
};
