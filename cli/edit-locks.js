/**
 * Mutation-time check of chemx team file locks (file_leases in .chemx/index.db).
 * The one lock decision: applyEdits and the patch/write guard (team/write-lock-guard.js) both use it.
 *
 * Read-only: it never creates the database or cleans leases. A lease blocks a mutation
 * when it is unexpired, its holder process (if recorded) is alive, and it belongs to an
 * agent other than the caller (options.agentId, else $CHEMX_AGENT_ID, else a per-process handle).
 */
import './silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { isPidAlive } from './team/team-db-transaction.js';
import { resolveAgentId as resolveTeamAgentId } from './team/agent-identity.js';

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[edit-locks] node:sqlite unavailable: ${err.message}\n`);
    return null;
  }
};
const DatabaseSync = await loadSqlite();

// One identity rule for locks and edits: explicit, then $CHEMX_AGENT_ID, then a per-process handle.
export const resolveAgentId = (agentId) => resolveTeamAgentId(agentId);

const readLeases = (root, keys) => {
  const dbPath = path.join(root, '.chemx', 'index.db');
  const canRead = Boolean(DatabaseSync) && fs.existsSync(dbPath);
  if (!canRead) return [];
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const placeholders = keys.map(() => '?').join(', ');
    const leases = db.prepare(`SELECT * FROM file_leases WHERE file_path IN (${placeholders})`).all(...keys);
    db.close();
    return leases;
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[edit-locks] lease lookup skipped: ${err.message}\n`);
    const isOpen = Boolean(db?.isOpen);
    if (isOpen) db.close();
    return [];
  }
};

// Lock dbs that can hold a lease on the file: the workspace root's, plus every ancestor of the
// file with a .chemx/index.db, so running from a subdirectory never hides a project-root lease.
const lockRoots = (root, absPath) => {
  const roots = [root];
  let dir = path.dirname(absPath);
  while (true) {
    const hasDb = fs.existsSync(path.join(dir, '.chemx', 'index.db'));
    const isNewRoot = hasDb && !roots.includes(dir);
    if (isNewRoot) roots.push(dir);
    const parent = path.dirname(dir);
    const isTop = parent === dir;
    if (isTop) break;
    dir = parent;
  }
  return roots;
};

// Keys a lease on absPath can carry in lockRoot's db: relative to that root, and the legacy
// caller-cwd-relative key that rows written before project-root keys used.
const leaseKeys = (lockRoot, absPath, root) => {
  const keys = [path.relative(lockRoot, absPath), path.relative(root, absPath)];
  const isInside = (key) => key !== '' && !key.startsWith('..') && !path.isAbsolute(key);
  return [...new Set(keys.filter(isInside))];
};

const isBlockingLease = (lease, agentId) => {
  const isExpired = Number(lease.expires_at) <= Date.now();
  const isDeadHolder = Number(lease.pid) > 0 && !isPidAlive(Number(lease.pid));
  const isOwn = lease.locked_by === resolveAgentId(agentId);
  return !isExpired && !isDeadHolder && !isOwn;
};

const blockingLease = (lockRoot, absPath, agentId, root) => {
  const keys = leaseKeys(lockRoot, absPath, root);
  const hasKeys = keys.length > 0;
  const lease = hasKeys ? readLeases(lockRoot, keys).find((row) => isBlockingLease(row, agentId)) : null;
  const hasLease = Boolean(lease);
  return hasLease ? { file: lease.file_path, lockedBy: lease.locked_by, expiresAt: Number(lease.expires_at), purpose: lease.purpose || '' } : null;
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
