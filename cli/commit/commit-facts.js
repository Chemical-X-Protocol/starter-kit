/**
 * Chemical X Protocol: the facts `chemx commit` checks before it stages anything (#2564).
 * Reads only (git, the lease tables, the team db); nothing is staged or written here.
 */
import path from 'node:path';
import { checkStagedLeases } from '../team/staged-leases.js';
import { activityHolder } from '../team/lease-activity.js';
import { findAndLoadConfigFile } from '../config/loader.js';
import { resolveTaskId } from './commit-message.js';
import { openCommitDb, taskExists } from './commit-record.js';
import { stagedPaths, isKnownFile } from './commit-git.js';

const isOutside = (rel) => rel.startsWith('..') || path.isAbsolute(rel);
const isWithin = (candidate, listed) => candidate === listed || candidate.startsWith(`${listed}/`);

const relativeFiles = (root, cwd, files) => files.map((file) => path.relative(root, path.resolve(cwd, file)));

const unrelatedOf = (root, inside) => stagedPaths(root).filter((staged) => !inside.some((listed) => isWithin(staged, listed)));

const taskFacts = (parsed, cwd) => {
  const taskId = resolveTaskId(parsed);
  const needsDb = Boolean(taskId) || parsed.noTask !== null;
  const db = needsDb ? openCommitDb(cwd) : null;
  const isTaskChecked = Boolean(taskId) && Boolean(db);
  const taskFound = isTaskChecked && taskExists(db, taskId);
  return { taskId, db, isTaskChecked, taskFound };
};

/**
 * @returns the facts record that collectRefusals and the runner read.
 */
export const gatherFacts = (parsed, cwd, root, env) => {
  const rel = relativeFiles(root, cwd, parsed.files);
  const outsideFiles = rel.filter(isOutside);
  const inside = rel.filter((file) => !isOutside(file));
  const unknownFiles = inside.filter((file) => !isKnownFile(root, file));
  const committer = activityHolder(parsed.as ?? undefined, env);
  const leaseResult = checkStagedLeases(inside, committer, { root });
  const config = findAndLoadConfigFile(root).raw?.commit ?? {};
  return {
    parsed, rel: inside, outsideFiles, unknownFiles, committer, config,
    unrelatedStaged: unrelatedOf(root, inside),
    leaseRefusals: leaseResult.refusals,
    leaseWarnings: leaseResult.warnings,
    ...taskFacts(parsed, cwd)
  };
};
