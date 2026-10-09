/**
 * Chemical X Protocol: fairness under contention (#2566).
 * Activity renewal (#2493) keeps a holder's leases alive on any chemx command. Without a limit a holder
 * that stays active but stopped editing a file keeps it forever while others queue for it.
 *
 * The rule: while at least one live waiter is queued for a lease, activity renewal stops extending it
 * once the holder has not edited THAT file for the cap (default 10 minutes; options.capMs or
 * $CHEMX_LEASE_CAP_MINUTES). A lease with no waiter renews exactly as before.
 * "Edited" means a chemx edit of the file by the holder (recorded in lease_edit_marks), else the time
 * the lease was acquired. Limits: a renewal made before a waiter arrived can already run up to one TTL
 * past the cap deadline; the cap never shortens a lease, it only stops extending it.
 */
import { safeAll, safeGet } from './team-db-readonly.js';
import { WAITER_TTL_MS, isOwnerProcessDead } from './team-db-lock-promotion.js';

export const DEFAULT_LEASE_CAP_MS = 10 * 60 * 1000;

/** Cap in ms: options.capMs, else $CHEMX_LEASE_CAP_MINUTES, else 10 minutes. */
export const leaseCapMs = (options = {}, env = process.env) => {
  const fromOption = Number(options.capMs);
  const isOptionSet = fromOption > 0;
  if (isOptionSet) return fromOption;
  const minutes = Number(env.CHEMX_LEASE_CAP_MINUTES);
  return minutes > 0 ? minutes * 60000 : DEFAULT_LEASE_CAP_MS;
};

const MARKS_SQL = 'CREATE TABLE IF NOT EXISTS lease_edit_marks (file_path TEXT PRIMARY KEY, locked_by TEXT NOT NULL, edited_at INTEGER NOT NULL)';
const MARK_UPSERT = `INSERT INTO lease_edit_marks (file_path, locked_by, edited_at) VALUES (?, ?, ?)
  ON CONFLICT(file_path) DO UPDATE SET locked_by = excluded.locked_by, edited_at = excluded.edited_at`;

/** Records that holder just edited the leased file. Needs a writable db. */
export const markEdit = (db, key, holder, now) => {
  db.exec(MARKS_SQL);
  db.prepare(MARK_UPSERT).run(key, holder, now);
};

/** When the holder last edited the leased file: the newest of the edit mark and the acquire time. */
export const lastEditAt = (db, lease) => {
  const mark = safeGet(db, 'SELECT locked_by, edited_at FROM lease_edit_marks WHERE file_path = ?', [lease.file_path]);
  const isOwnMark = Boolean(mark) && mark.locked_by === lease.locked_by;
  return Math.max(Number(lease.acquired_at) || 0, isOwnMark ? Number(mark.edited_at) : 0);
};

const lastSeen = (waiter) => (waiter.last_seen_at > 0 ? waiter.last_seen_at : waiter.requested_at);
const isStale = (waiter, now) => lastSeen(waiter) <= now - WAITER_TTL_MS || isOwnerProcessDead(waiter);

const WAITING_SQL = "SELECT * FROM file_lock_queue WHERE file_path = ? AND status = 'waiting' ORDER BY priority ASC, id ASC";

/** Queued waiters for a lease key that are still polling (the same staleness rule the queue uses). Read-only. */
export const liveWaiters = (db, key, now = Date.now()) => safeAll(db, WAITING_SQL, [key]).filter((waiter) => !isStale(waiter, now));

/**
 * @returns {{ waiters: Array<{ agent_id: string, requested_at: number }>, capAt: number, isCapped: boolean }}
 *   capAt = last edit + cap. isCapped = someone waits and capAt has passed (renewal no longer extends).
 */
export const contentionOf = (db, lease, now = Date.now(), capMs = leaseCapMs()) => {
  const waiters = liveWaiters(db, lease.file_path, now).map(({ agent_id, requested_at }) => ({ agent_id, requested_at }));
  const capAt = lastEditAt(db, lease) + capMs;
  return { waiters, capAt, isCapped: waiters.length > 0 && now >= capAt };
};

/** The expiry an activity renewal should aim for: now + TTL, held back to the cap deadline when someone waits. */
export const renewalTarget = (db, lease, now, ttlMs, capMs = leaseCapMs()) => {
  const target = now + ttlMs;
  const { waiters, capAt } = contentionOf(db, lease, now, capMs);
  return waiters.length > 0 ? Math.min(target, capAt) : target;
};
