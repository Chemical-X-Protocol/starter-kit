/**
 * Mutation-time check of chemx team file locks (file_leases in .chemx/index.db).
 * The one lock decision: applyEdits and the patch/write guard (team/write-lock-guard.js) both use it.
 *
 * findForeignLease is read-only (takeLeaseWhenFree, #4492, is the one writer): it never creates the database or cleans leases. A lease blocks a mutation
 * when it is unexpired, its holder process (if recorded) is alive, and it belongs to an
 * agent other than the caller (options.agentId, else $CHEMX_AGENT_ID, else a per-process handle).
 * Which dbs it reads comes from the coordination resolver (team/lease-roots.js, #2581), and every
 * open goes through openTeamDbReadOnly, so a spec process never reads a real db.
 */
import './silence-warnings.js';
import path from 'node:path';
import { isPidAlive } from './team/team-db-transaction.js';
import { resolveAgentId as resolveTeamAgentId, resolveAgentIdentity } from './team/agent-identity.js';
import { requestFileLock } from './team/team-db-locks.js';
import { teamRootFor } from './team/coordination-target.js';
import { liveWaiters } from './team/lease-cap.js';
import { lockRoots, leaseKeys } from './team/lease-roots.js';
import { openTeamDbReadOnly, openExistingTeamDb, closeQuietly } from './team/team-db-readonly.js';

// One identity rule for locks and edits: explicit, then $CHEMX_AGENT_ID, then a per-process handle.
export const resolveAgentId = (agentId) => resolveTeamAgentId(agentId);

const readLeases = (root, keys) => {
  const db = openTeamDbReadOnly(root);
  const canRead = Boolean(db);
  if (!canRead) return [];
  try {
    const placeholders = keys.map(() => '?').join(', ');
    const now = Date.now();
    const rows = db.prepare(`SELECT * FROM file_leases WHERE file_path IN (${placeholders})`).all(...keys);
    // An expired lease with a waiter belongs to the first waiter: the holder cannot retake it by editing (#2566).
    return rows.map((row) => (Number(row.expires_at) <= now ? { ...row, waiters: liveWaiters(db, row.file_path, now) } : row));
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[edit-locks] lease lookup skipped: ${err.message}\n`);
    return [];
  } finally {
    closeQuietly(db);
  }
};

// Lock dbs that can hold a lease on the file (the caller's root, then every team db the coordination
// resolver names for the file, team/lease-roots.js) and the keys a lease can carry in each: relative
// to that db's root, and the legacy caller-cwd-relative key that rows written before project-root keys used.

const isBlockingLease = (lease, agentId) => {
  const isExpired = Number(lease.expires_at) <= Date.now();
  const isDeadHolder = Number(lease.pid) > 0 && !isPidAlive(Number(lease.pid));
  const isOwn = lease.locked_by === resolveAgentId(agentId);
  return !isExpired && !isDeadHolder && !isOwn;
};

// The caller's own lapsed lease that someone is queued behind: not blocking for others, but not retakable by its holder.
const isLapsedWithQueue = (lease, agentId) => {
  const isOwn = lease.locked_by === resolveAgentId(agentId);
  const queue = (lease.waiters ?? []).filter((waiter) => waiter.agent_id !== lease.locked_by);
  return isOwn && Number(lease.expires_at) <= Date.now() && queue.length > 0;
};

const blockingLease = (lockRoot, absPath, agentId, root) => {
  const keys = leaseKeys(lockRoot, absPath, root);
  const hasKeys = keys.length > 0;
  const rows = hasKeys ? readLeases(lockRoot, keys) : [];
  const lease = rows.find((row) => isBlockingLease(row, agentId));
  if (lease) return { file: lease.file_path, lockedBy: lease.locked_by, expiresAt: Number(lease.expires_at), purpose: lease.purpose || '' };
  const lapsed = rows.find((row) => isLapsedWithQueue(row, agentId));
  const queue = (lapsed?.waiters ?? []).map((waiter) => waiter.agent_id);
  const hasLapsed = Boolean(lapsed);
  return hasLapsed ? { file: lapsed.file_path, lockedBy: queue[0], expiresAt: Number(lapsed.expires_at), purpose: lapsed.purpose || '', lapsedOwn: true, queue } : null;
};

/** @returns {{ file: string, lockedBy: string, expiresAt: number, purpose: string } | null} */
export const findForeignLease = (root, absPath, agentId) => {
  for (const lockRoot of lockRoots(root, absPath)) {
    const lease = blockingLease(lockRoot, absPath, agentId, root);
    const isBlocked = Boolean(lease);
    if (isBlocked) return lease;
  }
  return null;
};

const hasLiveLease = (root, absPath) => lockRoots(root, absPath).some((lockRoot) => {
  const rows = readLeases(lockRoot, leaseKeys(lockRoot, absPath, root));
  return rows.some((row) => Number(row.expires_at) > Date.now() && !(Number(row.pid) > 0 && !isPidAlive(Number(row.pid))));
});

// The agent's in_progress task becomes the lease purpose ("#<id>"); none claimed leaves it empty.
const claimedPurpose = (db, agentId) => {
  try {
    const row = db.prepare("SELECT id FROM agent_tasks WHERE assigned_agent_id = ? AND status = 'in_progress' ORDER BY updated_at DESC, id DESC LIMIT 1").get(agentId);
    return row ? `#${row.id}` : '';
  } catch {
    return ''; // chemx-allow: best-effort a db without the task table leaves the purpose empty
  }
};

/**
 * #4492: an identified agent (explicit id, $CHEMX_AGENT_ID or a session handle) that edits a file nobody
 * leases takes the lease first: same TTL and renewal rules as `team lock acquire`, a lock_acquired feed
 * event, purpose = its in_progress task. Anonymous callers, a missing team db and a spec process outside
 * the temp dir take nothing. Best effort: a failure here never blocks the edit, and callers run the
 * foreign-lease check first, so a file leased by someone else is refused before this runs.
 * @returns {{ taken: boolean, reason?: string, lease?: object }}
 */
export const takeLeaseWhenFree = (root, absPath, agentId, env = process.env) => {
  const identity = resolveAgentIdentity(agentId, env);
  const isAnonymous = identity.source === 'process';
  if (isAnonymous) return { taken: false, reason: 'anonymous' };
  const lockRoot = teamRootFor(path.dirname(absPath));
  const hasTeamRoot = Boolean(lockRoot);
  if (!hasTeamRoot) return { taken: false, reason: 'no_team_db' };
  const isLeased = hasLiveLease(root, absPath);
  if (isLeased) return { taken: false, reason: 'already_leased' };
  const db = openExistingTeamDb(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return { taken: false, reason: 'no_team_db' };
  try {
    const res = requestFileLock(db, absPath, identity.id, { cwd: root, purpose: claimedPurpose(db, identity.id) });
    return res.granted ? { taken: true, lease: res.lease } : { taken: false, reason: res.reason || 'not_granted' };
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[edit-locks] auto lease skipped: ${err.message}\n`);
    return { taken: false, reason: 'error' };
  } finally {
    closeQuietly(db);
  }
};
