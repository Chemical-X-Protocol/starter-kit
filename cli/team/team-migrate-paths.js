/**
 * Chemical X Protocol: paths in a merged db, re-based on the coordination root (#2488, #2506).
 * Lease-style paths (file_leases, lock queue, feed file_path) were relative to the source db's root;
 * they become root-relative. Task targets become repo-relative and the task's repo becomes the
 * target's owning package, so a kit task aimed at ../x-atoms/src/a.js lands as repo
 * apps/chemical-x/x-atoms, target src/a.js. A path that leaves the coordination root is kept as
 * written and counted as escaping; it is never invented. Each escaping target is listed with its
 * id, stored text and kind: 'relative' (a ../ path) or 'absolute' (an absolute path outside the
 * root, e.g. into another checkout; in a rehearsal on copies, absolute paths into the live checkout
 * land here too because the copy's root is elsewhere) (#2581).
 */
import path from 'node:path';
import { owningRepo, toRepoPath, repoDir } from './coordination-repos.js';
import { isInsideOrEqual } from './coordination-root.js';

const toPosix = (p) => p.split(path.sep).join('/');

export const createAttribution = (targetRoot, sourceRepo) => {
  const sourceDir = repoDir(targetRoot, sourceRepo);
  const stats = { normalized: 0, escapingTargets: [], escapingDetails: [], escapingPaths: 0, byRepo: {} };

  const rekeyPath = (stored) => {
    const absolute = path.resolve(sourceDir, stored);
    const isInside = isInsideOrEqual(targetRoot, absolute);
    if (!isInside) stats.escapingPaths++;
    return isInside ? toPosix(path.relative(targetRoot, absolute)) : stored;
  };

  const countRepo = (repo) => {
    stats.byRepo[repo] = (stats.byRepo[repo] ?? 0) + 1;
  };

  const attributeTask = (row) => {
    const rowDir = path.resolve(sourceDir, row.repo || '.');
    const baseRepo = owningRepo(targetRoot, rowDir) ?? sourceRepo;
    const hasTarget = typeof row.target_path === 'string' && row.target_path !== '';
    const split = hasTarget ? toRepoPath(targetRoot, path.resolve(rowDir, row.target_path)) : null;
    const isEscaping = Boolean(split?.error);
    if (isEscaping) stats.escapingTargets.push(row.id);
    if (isEscaping) stats.escapingDetails.push({ id: row.id, target: row.target_path, kind: path.isAbsolute(row.target_path) ? 'absolute' : 'relative' });
    const isUsable = Boolean(split) && !isEscaping && split.path !== '';
    const attributed = isUsable ? { repo: split.repo, target_path: split.path } : { repo: baseRepo, target_path: row.target_path ?? null };
    const isChanged = isUsable && (split.repo !== baseRepo || split.path !== row.target_path);
    if (isChanged) stats.normalized++;
    countRepo(attributed.repo);
    return attributed;
  };

  return { rekeyPath, attributeTask, stats: () => ({ ...stats, escapingTargets: [...stats.escapingTargets], escapingDetails: [...stats.escapingDetails] }) };
};
