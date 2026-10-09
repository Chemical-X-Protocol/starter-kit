import path from 'node:path';

/**
 * True when `child` is `parent` itself or lies below it (lexical check, no symlink resolution).
 * A sibling directory whose name merely starts with two dots (`..cache`) is still inside.
 * @param {string} child Path to test.
 * @param {string} parent Boundary directory.
 * @returns {boolean} Whether child stays within parent.
 */
export const isPathInside = (child, parent) => {
  const relative = path.relative(parent, child);
  const isParentSegment = relative === '..' || relative.startsWith(`..${path.sep}`);
  const isOutside = isParentSegment || path.isAbsolute(relative);
  return !isOutside;
};
