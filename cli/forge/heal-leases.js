// All-or-nothing leases for a heal (engine doc, Heal: SAFETY SEQUENCE 2): every path is checked for a
// foreign lease before any lease is taken, then every path is leased; one refusal releases what this
// heal took and refuses the whole heal with CHEMX_FILE_LOCKED. There are no partial heals.
import path from 'node:path';
import { findForeignLease } from '../edit-locks.js';
import { openTeamDb } from '../team/coordination-db.js';
import { requestFileLock, releaseFileLock, getFileLockStatus } from '../team/team-db-locks.js';
import { HealError } from './heal-text.js';

const describeForeign = (entry) => `${entry.file} is leased by ${entry.lease.lockedBy}${entry.lease.purpose ? ` (${entry.lease.purpose})` : ''}`;

/** Foreign leases on any of the paths: [{ file, lease }]. Read-only. */
export const foreignLeases = (root, files, agentId) => files
  .map((file) => ({ file, lease: findForeignLease(root, path.join(root, file), agentId) }))
  .filter((entry) => Boolean(entry.lease));

const isHeldBy = (db, file, agentId, root) => getFileLockStatus(db, file, { cwd: root })?.lease?.locked_by === agentId;

/** Releases the leases this heal took (never ones the agent held before the heal). */
export const releaseTaken = (root, taken, agentId) => {
  const db = openTeamDb(root);
  const hasDb = Boolean(db);
  if (!hasDb) return;
  for (const file of taken) releaseFileLock(db, file, agentId, { cwd: root });
};

/**
 * Leases every path for agentId, or none. Returns { taken: [files newly leased], held: [files already
 * held] }. Throws HealError CHEMX_FILE_LOCKED naming every foreign holder; nothing is leased then.
 */
export const acquireAll = (root, files, { agentId, purpose }) => {
  const foreign = foreignLeases(root, files, agentId);
  const hasForeign = foreign.length > 0;
  if (hasForeign) throw new HealError('CHEMX_FILE_LOCKED', `${foreign.map(describeForeign).join('; ')}; nothing was written`, { files: foreign.map((entry) => entry.file) });
  const db = openTeamDb(root);
  const hasDb = Boolean(db);
  if (!hasDb) throw new HealError('CHEMX_FILE_LOCKED', 'no team db to take leases in; nothing was written');
  const held = files.filter((file) => isHeldBy(db, file, agentId, root));
  const taken = [];
  for (const file of files.filter((candidate) => !held.includes(candidate))) {
    const grant = requestFileLock(db, file, agentId, { purpose, cwd: root });
    const isGranted = Boolean(grant.granted);
    if (isGranted) {
      taken.push(file);
      continue;
    }
    releaseTaken(root, taken, agentId);
    const holder = grant.currentHolder ?? grant.heldBy ?? grant.reason ?? 'another handle';
    throw new HealError('CHEMX_FILE_LOCKED', `${file} could not be leased (${holder}); the leases this heal took were released and nothing was written`, { files: [file] });
  }
  return { taken, held };
};
