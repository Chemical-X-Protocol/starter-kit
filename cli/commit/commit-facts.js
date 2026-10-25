/**
 * Chemical X Protocol: the facts `chemx commit` checks before it stages anything (#2564).
 * Reads only (git, the lease tables, the team db); nothing is staged or written here.
 */
import path from 'node:path';
import { checkStagedLeases } from '../team/staged-leases.js';
import { activityHolder } from '../team/lease-activity.js';
import { findAndLoadConfigFile } from '../config/loader.js';
import { resolveHandleBoard } from '../team/board-resolve.js';
import { resolveTaskId, wantsSkipCi } from './commit-message.js';
import { openCommitDb } from './commit-record.js';
import { stagedPaths, isKnownFile, isOnDefaultBranch } from './commit-git.js';

const isOutside = (rel) => rel.startsWith('..') || path.isAbsolute(rel);
const isWithin = (candidate, listed) => candidate === listed || candidate.startsWith(`${listed}/`);

const relativeFiles = (root, cwd, files) => files.map((file) => path.relative(root, path.resolve(cwd, file)));

const unrelatedOf = (root, inside) => stagedPaths(root).filter((staged) => !inside.some((listed) => isWithin(staged, listed)));

// The board that checks the task number and receives the commit event (board-resolve.js): --board, the
// committer's claimed board, else cwd's. The number typed is read in the caller's repo there (aliases first).
const taskFacts = (parsed, cwd, committer, env) => {
  const taskId = resolveTaskId(parsed);
  const needsDb = Boolean(taskId) || parsed.noTask !== null;
  const board = needsDb ? resolveHandleBoard(cwd, { handle: committer, board: parsed.board, taskRef: taskId, env }) : null;
  const db = board?.root ? openCommitDb(board.root) : null;
  const isTaskChecked = Boolean(taskId) && Boolean(db);
  const taskFound = isTaskChecked && board.found;
  const boardTaskId = taskFound ? board.taskId : taskId;
  return {
    taskId, boardTaskId, db, isTaskChecked, taskFound,
    board: board?.root ? { root: board.root, source: board.source } : null,
    boardLooked: board?.looked ?? [],
    boardError: board?.error ?? null
  };
};

const skipCiFact = (parsed, config, root) => {
  const needsBranch = Boolean(config?.skipCi) && !parsed.skipCi && !parsed.noSkipCi;
  const isDefaultBranch = needsBranch ? isOnDefaultBranch(root) : false;
  return wantsSkipCi({ isForced: parsed.skipCi, isSuppressed: parsed.noSkipCi, config, isDefaultBranch });
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
    isSkipCi: skipCiFact(parsed, config, root),
    unrelatedStaged: unrelatedOf(root, inside),
    leaseRefusals: leaseResult.refusals,
    leaseWarnings: leaseResult.warnings,
    ...taskFacts(parsed, cwd, committer, env)
  };
};
