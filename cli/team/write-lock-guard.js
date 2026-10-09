/**
 * Chemical X Protocol: Write lock guard.
 * chemx write/patch refuse up front (CHEMX_FILE_LOCKED) on a file another agent leases.
 * The decision itself is edit-locks.js's findForeignLease, the same one applyEdits uses,
 * so patch/write and autofix/explode/mutators can never disagree about a lease.
 */

import { findForeignLease } from '../edit-locks.js';

export const findBlockingLease = (resolvedPath, cwd = process.cwd(), agentId) => {
  const lease = findForeignLease(cwd, resolvedPath, agentId);
  const isClear = !lease;
  if (isClear) return null;
  return { file_path: lease.file, locked_by: lease.lockedBy, expires_at: lease.expiresAt, purpose: lease.purpose, active: true };
};

export const assertWriteLockClear = (resolvedPath, cwd = process.cwd(), agentId) => {
  const lease = findBlockingLease(resolvedPath, cwd, agentId);
  const isClear = !lease;
  if (isClear) return;
  const until = new Date(lease.expires_at).toISOString();
  const purpose = lease.purpose ? ` for "${lease.purpose}"` : '';
  const err = new Error(
    `Refusing to modify ${lease.file_path}: locked by ${lease.locked_by}${purpose} until ${until}. ` +
    `Wait for the release, or pass your own identity (--as / agentId) if you hold the lock.`
  );
  err.code = 'CHEMX_FILE_LOCKED';
  err.isRefusal = true;
  err.lease = lease;
  throw err;
};
