/**
 * Chemical X Protocol: what `chemx commit` records in the team db (#2564).
 * Goes through the team db API (openIndexDb, postFeedEvent, releaseFileLock), so it follows the
 * shared-db resolution. Recording is best effort: a commit that already landed is never undone
 * because the db was unavailable; the result says whether the event was recorded.
 */
import { openIndexDb } from '../search-db.js';
import { getTask, postFeedEvent, registerAgent } from '../team/team-db.js';
import { releaseFileLock } from '../team/team-db-locks.js';

/** The team db for cwd, or null when sqlite is unavailable. */
export const openCommitDb = (cwd) => {
  try {
    return openIndexDb(cwd);
  } catch {
    return null;
  }
};

export const taskExists = (db, taskId) => Boolean(getTask(db, taskId));

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
