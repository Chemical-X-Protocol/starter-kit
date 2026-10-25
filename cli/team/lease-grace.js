/**
 * Chemical X Protocol: the activity window (#6758).
 * A lease lasts one TTL (5 minutes) from the holder's last chemx call; that stays the rule for everyone
 * else: after 5 minutes the file is free to any other handle, and an edit or an acquire by another handle
 * takes it. But a builder is often quiet for longer than that while it still works: a non-chemx runner
 * (a 90 s plugin suite), a long spec being written. So when the holder's next chemx command of any kind
 * (test, check, read, q, claim, ...) finds a lease of its own that lapsed, it comes back, if all hold:
 *   - the holder has a task in_progress on that board;
 *   - the holder's last chemx call was at most ACTIVE_WINDOW_MS (15 minutes) ago, which for a lease
 *     renewed at that call means it expired at most 10 minutes ago;
 *   - nobody took the file meanwhile (a row of another handle, or a grant from the queue, ends it);
 *   - nobody is queued for it (a live waiter owns it next, see lease-cap.js);
 *   - the lapse was the TTL, not a dead holder process.
 * The revived lease keeps its purpose and gets a full TTL; a `lock_acquired` feed event records it, which
 * also clears the lapse from every later message. Read side first (findGraceCandidates), then write.
 * Not guaranteed: while the lease was lapsed the file was free, so another handle may have edited it
 * (an edit takes a lease, which then blocks the revival) or may have read it without taking one (which
 * does not). The revival never takes a file back from a handle that holds or awaits it; it cannot tell
 * what a handle that held nothing did.
 */
import { lapseFor } from './lease-reacquire.js';
import { liveWaiters } from './lease-cap.js';
import { minutesAgo } from './lease-lapse.js';
import { postFeedEvent } from './team-db-feed.js';
import { isOwnerProcessDead } from './team-db-lock-promotion.js';
import { safeAll, safeGet } from './team-db-readonly.js';

export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const FEED_SCAN_LIMIT = 200;

const KEPT_SQL = 'SELECT file_path, purpose, pid FROM file_leases WHERE locked_by = ? AND expires_at <= ? AND expires_at >= ?';
const EXPIRED_SQL = "SELECT file_path, metadata FROM agent_feed WHERE event_type = 'lock_expired' AND timestamp >= ? ORDER BY id DESC LIMIT ?";
const IN_PROGRESS_SQL = "SELECT 1 AS ok FROM agent_tasks WHERE assigned_agent_id = ? AND status = 'in_progress' LIMIT 1";
const KEPT_UPDATE = 'UPDATE file_leases SET acquired_at = ?, expires_at = ? WHERE file_path = ? AND locked_by = ? AND expires_at = ?';
const INSERT_SQL = `INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid)
  VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(file_path) DO NOTHING`;

/** The oldest expiry a lapsed lease may have and still come back: the holder's last call (one TTL earlier) is inside the window. */
export const graceEarliest = (now, ttlMs) => now - Math.max(0, ACTIVE_WINDOW_MS - ttlMs);

const metaOf = (row) => {
  try {
    return JSON.parse(row.metadata || '{}');
  } catch {
    return {}; // chemx-allow: best-effort a feed row with damaged metadata simply names no holder
  }
};

// Expired rows nobody has cleaned yet. A dead holder process is a different lapse: not revived.
const keptCandidates = (db, holder, now, earliest) => safeAll(db, KEPT_SQL, [holder, now, earliest])
  .filter((row) => !isOwnerProcessDead(row))
  .map((row) => ({ key: row.file_path, purpose: row.purpose }));

// Rows cleanup already deleted: the feed's lock_expired record names the holder, the expiry and the purpose.
const cleanedCandidates = (db, holder, earliest) => safeAll(db, EXPIRED_SQL, [earliest, FEED_SCAN_LIMIT])
  .map((row) => ({ key: row.file_path, meta: metaOf(row) }))
  .filter(({ meta }) => meta.holder === holder && meta.reason === 'TTL expired' && Number(meta.expires_at) >= earliest)
  .map(({ key, meta }) => ({ key, purpose: meta.purpose || '' }));

const uniqueByKey = (candidates) => candidates.filter((candidate, at) => candidates.findIndex((other) => other.key === candidate.key) === at);

/**
 * Read-only. The holder's lapsed leases on this board that may come back now.
 * @param {object} db A team db (read-only is enough).
 * @returns {Array<{ key: string, purpose: string, lapse: { expiredAt: number, rowKept: boolean } }>}
 */
export const findGraceCandidates = (db, holder, now, ttlMs) => {
  const earliest = graceEarliest(now, ttlMs);
  const found = uniqueByKey([...keptCandidates(db, holder, now, earliest), ...cleanedCandidates(db, holder, earliest)]);
  const hasAny = found.length > 0;
  if (!hasAny) return [];
  const hasTask = Boolean(safeGet(db, IN_PROGRESS_SQL, [holder]));
  if (!hasTask) return [];
  return found
    .map((candidate) => ({ ...candidate, lapse: lapseFor(db, candidate.key, holder, now) }))
    .filter((candidate) => Boolean(candidate.lapse) && candidate.lapse.expiredAt >= earliest);
};

// Each statement touches only the exact row it judged, so a concurrent grant to someone else wins.
const retakeRow = (db, holder, candidate, now, ttlMs) => {
  const { key, lapse, purpose } = candidate;
  const expiresAt = now + ttlMs;
  return lapse.rowKept
    ? db.prepare(KEPT_UPDATE).run(now, expiresAt, key, holder, lapse.expiredAt)
    : db.prepare(INSERT_SQL).run(key, holder, now, expiresAt, purpose);
};

const reviveOne = (db, holder, candidate, now, ttlMs) => {
  const isContested = liveWaiters(db, candidate.key, now).length > 0;
  if (isContested) return false;
  const isRetaken = Number(retakeRow(db, holder, candidate, now, ttlMs).changes) === 1;
  if (!isRetaken) return false;
  const ago = minutesAgo(candidate.lapse.expiredAt, now);
  postFeedEvent(db, { author_id: holder, event_type: 'lock_acquired', file_path: candidate.key, message: `${holder} revived lock on ${candidate.key}; it had lapsed ${ago} min ago and nobody took it` });
  return true;
};

/**
 * @param {object} db Writable team db.
 * @param {Array} candidates From findGraceCandidates.
 * @returns {number} Leases brought back.
 */
export const reviveLapsed = (db, holder, candidates, now, ttlMs) => candidates.filter((candidate) => reviveOne(db, holder, candidate, now, ttlMs)).length;
