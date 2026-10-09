/**
 * Chemical X Protocol: renew-on-edit.
 * After applyEdits writes files, the caller's own live lease on each one is extended by one TTL,
 * so a stage that keeps editing never loses its lock halfway through. A caller with no lease on
 * the file never opens the db for writing: a read-only lookup comes first, then one UPDATE per
 * lock db that really holds a lease of theirs. Fails open: any error leaves leases as they were.
 *
 * Lock roots and keys mirror edit-locks.js (findForeignLease) so renewal sees the same rows the
 * refusal check sees.
 */
import path from 'node:path';
import { lockRoots, leaseKeys } from './lease-roots.js';
import { openTeamDbReadOnly, openExistingTeamDb, closeQuietly, safeAll } from './team-db-readonly.js';
import { renewHeldLease } from './team-db-locks.js';
import { resolveAgentId } from './agent-identity.js';
import { reacquireLapsedAfterEdit } from './lease-reacquire.js';
import { clockTime, describeLapse } from './lease-lapse.js';

// lockRoot -> Set of keys, so each lock db is read once however many files the batch touched.
const keysByRoot = (root, absPaths) => {
  const byRoot = new Map();
  for (const absPath of absPaths) {
    for (const lockRoot of lockRoots(root, absPath)) {
      const keys = byRoot.get(lockRoot) ?? new Set();
      leaseKeys(lockRoot, absPath, root).forEach((key) => keys.add(key));
      byRoot.set(lockRoot, keys);
    }
  }
  return byRoot;
};

const heldLiveKeys = (lockRoot, keys, holder, now) => {
  const db = openTeamDbReadOnly(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `SELECT file_path FROM file_leases WHERE locked_by = ? AND expires_at > ? AND file_path IN (${placeholders})`;
  const rows = safeAll(db, sql, [holder, now, ...keys]);
  closeQuietly(db);
  return rows.map((row) => row.file_path);
};

const renewInRoot = (lockRoot, keys, holder, options) => {
  const held = heldLiveKeys(lockRoot, keys, holder, options.now);
  const hasHeld = held.length > 0;
  if (!hasHeld) return [];
  const db = openExistingTeamDb(lockRoot);
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  try {
    return held.filter((key) => renewHeldLease(db, key, holder, options).renewed).map((key) => path.join(lockRoot, key));
  } finally {
    closeQuietly(db);
  }
};

/**
 * @param {string} root Workspace root applyEdits resolved paths against.
 * @param {string[]} absPaths Files the batch wrote or deleted.
 * @param {string} [agentId] The caller (explicit, else $CHEMX_AGENT_ID, else session, else process).
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {string[]} Absolute paths whose lease was extended.
 */
export const renewLeasesAfterEdit = (root, absPaths, agentId, options = {}) => {
  try {
    const holder = resolveAgentId(agentId);
    const opts = { ...options, now: options.now ?? Date.now() };
    const renewed = [];
    for (const [lockRoot, keys] of keysByRoot(root, absPaths)) {
      renewed.push(...renewInRoot(lockRoot, [...keys], holder, opts));
    }
    return renewed;
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[lease-renew] renewal skipped: ${err.message}\n`);
    return [];
  }
};

/**
 * Everything an edit does to the caller's leases: extend live ones, retake lapsed untaken ones.
 * `notes` are ready-to-print sentences for every lease that had lapsed; renewals need no note.
 * @returns {{ renewed: string[], reacquired: object[], notes: string[] }}
 */
export const syncLeasesAfterEdit = (root, absPaths, agentId, options = {}) => {
  const renewed = renewLeasesAfterEdit(root, absPaths, agentId, options);
  const reacquired = reacquireLapsedAfterEdit(root, absPaths, agentId, options);
  const now = options.now ?? Date.now();
  const notes = reacquired.map((lease) => {
    const lapsed = describeLapse(lease.key, { expiredAt: lease.lapsedAt }, now);
    return `${lapsed}; nobody had taken it, so this edit re-acquired it until ${clockTime(lease.expiresAt)}`;
  });
  return { renewed, reacquired, notes };
};
