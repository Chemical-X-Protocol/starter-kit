/**
 * Cross-file gate for task done (design spec 5.3): a PHP target in a WordPress root can raise a
 * finding anchored in a file that depends on it. Re-audits each dependent with the target as it is
 * on disk and as it is at HEAD, and reports every rule whose count rose. Guarantees only what the
 * per-plugin index resolves: staged-delta and base-delta gates do not run this check.
 */
import path from 'node:path';
import { auditFile } from '../audit-scan.js';
import { isPhpPath } from '../php/php-parse.js';
import { detectWordPress } from '../php/wp-detect.js';
import { getProjectIndex } from '../php/wp-project-index.js';
import { diffViolations } from '../audit/gate-delta.js';
import { gitText } from '../audit/staged-delta.js';

const dependentsOfTarget = (fullPath, cwd, config) => {
  const wp = detectWordPress(fullPath, { scanRoot: cwd, config });
  const hasRoot = Boolean(wp.isWordPress && wp.root);
  if (!hasRoot) return { dependents: [], root: null };
  const index = getProjectIndex(wp.root);
  return { dependents: index.dependentsOf(path.relative(wp.root, fullPath)), root: wp.root };
};

/**
 * @param {{ cwd: string, targetPath: string, fullPath: string, config?: object }} params
 * @returns {{ file: string, increases: object[] }[]} dependents whose rule counts rose; [] when none
 *   (also when the target is not PHP, not in a WordPress root, has no HEAD version or has no dependents)
 */
export const dependentRegressions = ({ cwd, targetPath, fullPath, config = null }) => {
  if (!isPhpPath(fullPath)) return [];
  const headText = gitText(cwd, ['show', `HEAD:./${targetPath}`]);
  const hasHeadVersion = headText !== null;
  if (!hasHeadVersion) return [];
  const { dependents, root } = dependentsOfTarget(fullPath, cwd, config);
  const overlay = { relativePath: fullPath, content: headText };
  const regressions = [];
  for (const dependent of dependents) {
    const absolute = path.join(root, dependent);
    const relative = path.relative(cwd, absolute);
    const atDisk = auditFile(absolute, relative, { cwd });
    const atHead = auditFile(absolute, relative, { cwd, overlay });
    const increases = diffViolations(atHead, atDisk);
    const hasRise = increases.length > 0;
    if (hasRise) regressions.push({ file: relative, increases });
  }
  return regressions;
};
