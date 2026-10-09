/**
 * Chemical X Protocol: Write lock guard.
 * chemx write/patch consult file leases so a lock actually excludes other agents.
 * A project without an index db has no leases, so the guard never creates one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findChemxDir } from '../audit/history.js';
import { openIndexDb } from '../search-schema.js';
import { describeLease } from './team-db-lock-promotion.js';
import { resolveAgentId } from './agent-identity.js';

const readLeaseRows = (db, keys) => {
  try {
    const placeholders = keys.map(() => '?').join(', ');
    return db.prepare(`SELECT * FROM file_leases WHERE file_path IN (${placeholders})`).all(...keys);
  } catch (err) {
    const isNoSuchTable = String(err?.message).includes('no such table');
    if (isNoSuchTable) return [];
    throw err;
  }
};

export const findBlockingLease = (resolvedPath, cwd = process.cwd(), agentId) => {
  const chemxDir = findChemxDir(cwd);
  const hasIndexDb = fs.existsSync(path.join(chemxDir, 'index.db'));
  if (!hasIndexDb) return null;
  const db = openIndexDb(cwd);
  if (!db) return null;

  // Lease keys are stored relative to the cwd the lock was taken from; normally that is the project root.
  const projectRoot = path.dirname(chemxDir);
  const keys = [...new Set([path.relative(projectRoot, resolvedPath), path.relative(cwd, resolvedPath)])];
  const writerId = resolveAgentId(agentId);
  const isHeldByOther = (lease) => lease.active && lease.locked_by !== writerId;
  const blocking = readLeaseRows(db, keys).map((row) => describeLease(row)).find(isHeldByOther);
  return blocking || null;
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
