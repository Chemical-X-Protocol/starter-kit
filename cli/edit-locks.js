/**
 * Mutation-time check of chemx team file locks (file_leases in .chemx/index.db).
 *
 * Read-only: it never creates the database or cleans leases. A lease blocks a mutation
 * when it is unexpired, its holder process (if recorded) is alive, and it belongs to an
 * agent other than the caller (options.agentId, else $CHEMX_AGENT_ID, else '@agent').
 */
import './silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { isPidAlive } from './team/team-db-transaction.js';

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[edit-locks] node:sqlite unavailable: ${err.message}\n`);
    return null;
  }
};
const DatabaseSync = await loadSqlite();

export const DEFAULT_AGENT_ID = '@agent';

export const normalizeAgent = (id) => {
  const value = String(id || DEFAULT_AGENT_ID);
  const isPrefixed = value.startsWith('@');
  return isPrefixed ? value : `@${value}`;
};

export const resolveAgentId = (agentId) => normalizeAgent(agentId || process.env.CHEMX_AGENT_ID);

const readLease = (root, relPath) => {
  const dbPath = path.join(root, '.chemx', 'index.db');
  const canRead = Boolean(DatabaseSync) && fs.existsSync(dbPath);
  if (!canRead) return null;
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const lease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(relPath) || null;
    db.close();
    return lease;
  } catch (err) {
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[edit-locks] lease lookup skipped: ${err.message}\n`);
    const isOpen = Boolean(db?.isOpen);
    if (isOpen) db.close();
    return null;
  }
};

/**
 * Lock databases that can hold a lease on the file: the workspace root's, plus every ancestor
 * directory of the file that has a .chemx/index.db. Running from a subdirectory (root = cwd)
 * must not hide a lease taken at the project root.
 */
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

const blockingLease = (lockRoot, absPath, agentId) => {
  const relPath = path.relative(lockRoot, absPath);
  const lease = readLease(lockRoot, relPath);
  if (!lease) return null;
  const isExpired = Number(lease.expires_at) <= Date.now();
  const isDeadHolder = Number(lease.pid) > 0 && !isPidAlive(Number(lease.pid));
  const isOwn = lease.locked_by === resolveAgentId(agentId);
  const isBlocking = !isExpired && !isDeadHolder && !isOwn;
  return isBlocking ? { file: relPath, lockedBy: lease.locked_by, expiresAt: Number(lease.expires_at), purpose: lease.purpose || '' } : null;
};

/**
 * @param {string} root Workspace root.
 * @param {string} absPath Validated absolute target.
 * @param {string} [agentId] Caller identity.
 * @returns {{ file: string, lockedBy: string, expiresAt: number, purpose: string } | null}
 */
export const findForeignLease = (root, absPath, agentId) => {
  for (const lockRoot of lockRoots(root, absPath)) {
    const lease = blockingLease(lockRoot, absPath, agentId);
    if (lease) return lease;
  }
  return null;
};
