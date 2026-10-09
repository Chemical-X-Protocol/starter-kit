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

let DatabaseSync = null;
try {
  DatabaseSync = (await import('node:sqlite')).DatabaseSync;
} catch {
  DatabaseSync = null;
}

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
    return db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(relPath) || null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
};

/**
 * @param {string} root Workspace root.
 * @param {string} absPath Validated absolute target.
 * @param {string} [agentId] Caller identity.
 * @returns {{ file: string, lockedBy: string, expiresAt: number, purpose: string } | null}
 */
export const findForeignLease = (root, absPath, agentId) => {
  const relPath = path.relative(root, absPath);
  const lease = readLease(root, relPath);
  if (!lease) return null;
  const isExpired = Number(lease.expires_at) <= Date.now();
  const isDeadHolder = Number(lease.pid) > 0 && !isPidAlive(Number(lease.pid));
  const isOwn = lease.locked_by === resolveAgentId(agentId);
  const isBlocking = !isExpired && !isDeadHolder && !isOwn;
  if (!isBlocking) return null;
  return { file: relPath, lockedBy: lease.locked_by, expiresAt: Number(lease.expires_at), purpose: lease.purpose || '' };
};
