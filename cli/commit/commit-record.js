/**
 * Chemical X Protocol: what `chemx commit` records in the team db (#2564).
 * The db is the one the coordination resolver picks for cwd (openTeamContext), the same db the
 * `chemx team` commands use, so a commit never writes team rows into a package db the resolver
 * would not read. Recording is best effort: a commit that already landed is never undone
 * because the db was unavailable; the result says whether the event was recorded.
 */
import fs from 'node:fs';
import { openTeamContext, resolveTeamDbTarget } from '../team/coordination-db.js';
import { getTask, postFeedEvent, registerAgent } from '../team/team-db.js';
import { releaseFileLock } from '../team/team-db-locks.js';
import { resolveTaskRef } from '../team/task-ref.js';

const hasResolvedDb = (target) => !target.refused && fs.existsSync(target.dbPath);

/** The team db for cwd, or null when sqlite is unavailable, the call is refused (spec process) or the resolved db file does not exist (never creates one). */
export const openCommitDb = (cwd) => {
  const target = resolveTeamDbTarget(cwd);
  if (!hasResolvedDb(target)) return null;
  try {
    return openTeamContext(cwd).db;
  } catch {
    return null;
  }
};

/** The repo ('.' = the coordination root) cwd belongs to, for resolving task ids. */
export const repoOf = (cwd) => resolveTeamDbTarget(cwd).repo;

/** The board task id that a typed #N means in repo (aliases first), or null when the board has no such task. */
export const boardTaskId = (db, taskId, repo) => {
  const resolved = resolveTaskRef(db, taskId, { repo });
  return getTask(db, resolved.id) ? resolved.id : null;
};

export const taskExists = (db, taskId, repo = '.') => boardTaskId(db, taskId, repo) !== null;

const eventAuthor = (committer) => committer || '@system';

/**
 * Posts the commit as an activity event on the task (or an unattached event with the --no-task reason).
 * @returns {boolean} whether an event was written
 */
export const recordCommit = (db, { committer, taskId, noTask, sha, subject, files }) => {
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  const author = eventAuthor(committer);
  registerAgent(db, { id: author, role: 'contributor' });
  const reason = noTask ? ` (no task: ${noTask})` : '';
  const event = postFeedEvent(db, {
    author_id: author,
    task_id: taskId ? Number(taskId) : null,
    event_type: 'commit',
    message: `commit ${sha} ${subject}${reason}`,
    metadata: { sha, subject, files, noTask: noTask ?? null }
  });
  return Boolean(event);
};

/**
 * Releases the committer's own leases on the listed files. Files it holds no lease on are skipped.
 * @returns {string[]} the files whose lease was released
 */
export const releaseLeases = (db, committer, files, cwd) => {
  const canRelease = Boolean(db) && Boolean(committer);
  if (!canRelease) return [];
  return files.filter((file) => releaseFileLock(db, file, committer, { cwd }).success);
};
