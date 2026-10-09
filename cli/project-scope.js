// The project scope: the part of a project the index, q and the audit cover by default.
// One answer for all three: the `scope` key of .chemx/config.json (or chemx.config), else the
// whole project root ('.'). Inside that scope the index keeps every git-tracked source file plus
// untracked files .gitignore allows (search-scan.js); a git-ignored file is indexed only when its
// dir is passed explicitly (--dir). There is no 'src if it exists' guess (#2037).
import path from 'node:path';
import { readConfiguredScope, toRelDir } from './audit-scope.js';

/**
 * @param {string} root Project root (the dir that holds .chemx).
 * @returns {{ relDir: string, source: 'config'|'root' }} relDir is root-relative posix. A
 *   configured scope is returned even when the dir is missing, so the index sync can answer
 *   inconclusive for it instead of silently widening to the root.
 */
export const resolveProjectScope = (root) => {
  const configured = readConfiguredScope(root);
  const hasConfiguredScope = configured !== null;
  if (!hasConfiguredScope) return { relDir: '.', source: 'root' };
  return { relDir: toRelDir(root, path.resolve(root, configured)), source: 'config' };
};
