/**
 * Chemical X Protocol: showing who waits behind a lease and when its renewal stops (#2566).
 * Read-only. describeContention is the one sentence `lock list`, `lock status` and `chemx status` print;
 * contentionByPath feeds `chemx status` (every contested live lease under cwd's lock dbs, by absolute path).
 */
import path from 'node:path';
import { ancestorLockRoots } from './lease-roots.js';
import { openTeamDbReadOnly, closeQuietly, safeAll } from './team-db-readonly.js';
import { contentionOf } from './lease-cap.js';
import { clockTime } from './lease-lapse.js';

/** "waiting: @a (since 11:40:02), @b; renewal stops extending at 11:55:00" (or "stopped at" once past). */
export const describeContention = ({ waiters, capAt, isCapped }) => {
  const names = waiters.map((w, i) => (i === 0 ? `${w.agent_id} (since ${clockTime(w.requested_at)})` : w.agent_id)).join(', ');
  const verb = isCapped ? 'stopped' : 'stops';
  return `waiting: ${names}; renewal ${verb} extending at ${clockTime(capAt)}`;
};

const contestedIn = (root, now) => {
  const db = openTeamDbReadOnly(root);
  const hasDb = Boolean(db);
  if (!hasDb) return [];
  const leases = safeAll(db, 'SELECT * FROM file_leases WHERE expires_at > ?', [now]);
  const found = leases.map((lease) => [path.resolve(root, lease.file_path), contentionOf(db, lease, now)]);
  closeQuietly(db);
  return found.filter(([, contention]) => contention.waiters.length > 0);
};

/** @returns {Map<string, { waiters: object[], capAt: number, isCapped: boolean }>} absolute path -> contention, contested leases only. */
export const contentionByPath = (cwd, now = Date.now()) => new Map(ancestorLockRoots(cwd).flatMap((root) => contestedIn(root, now)));
