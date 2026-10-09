/**
 * Chemical X Protocol: read-only view of live leases and task status for chemx status and chemx wait.
 * Which dbs it reads comes from the coordination resolver (#2581): the db serving cwd, plus any
 * unmerged package db between cwd and the coordination root (coordination-target.js teamDbRootsFor).
 * Nothing outside the coordination root is read, and nothing is created, migrated or cleaned.
 * Limit: leases are matched by their root-relative key; a legacy cwd-relative key in a nested db is not seen.
 */
import path from 'node:path';
import { teamDbRootsFor, resolveTeamDbTarget } from './team/coordination-target.js';
import { openTeamDbReadOnly, closeQuietly, safeAll, safeGet } from './team/team-db-readonly.js';
import { resolveTaskRef } from './team/task-ref.js';

const LEASE_SQL = 'SELECT file_path, locked_by, acquired_at, expires_at, purpose FROM file_leases WHERE expires_at > ?';

const leasesInRoot = (root, now) => {
  const db = openTeamDbReadOnly(root);
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  const rows = safeAll(db, LEASE_SQL, [now]);
  closeQuietly(db);
  return rows.map((row) => ({ ...row, abs: path.resolve(root, row.file_path) }));
};

/**
 * Every unexpired lease visible from cwd, each with its absolute path. alsoFrom adds the team dbs
 * of other dirs (a file's own dir), so a lease taken from a package below cwd is seen too.
 */
export const liveLeases = (cwd, now = Date.now(), alsoFrom = []) => {
  const roots = [...new Set([cwd, ...alsoFrom].flatMap((dir) => teamDbRootsFor(dir)))];
  return roots.flatMap((root) => leasesInRoot(root, now));
};

/**
 * The status of task id in the db that serves cwd, or null when that db does not have it.
 * The id resolves like `chemx team task show` from cwd: an alias of cwd's repo wins after a merge.
 */
export const taskStatus = (cwd, id) => {
  const target = resolveTeamDbTarget(cwd);
  const db = target.refused ? null : openTeamDbReadOnly(target.root);
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  try {
    const ref = resolveTaskRef(db, id, { repo: target.repo });
    return safeGet(db, 'SELECT status FROM agent_tasks WHERE id = ?', [ref.id ?? id])?.status ?? null;
  } finally {
    closeQuietly(db);
  }
};
