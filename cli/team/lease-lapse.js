/**
 * Chemical X Protocol: making a lapsed lease visible.
 * cleanExpiredLeases deletes an expired row and records a lock_expired feed event carrying the holder
 * and the original expiry. This module reads that record back, so release, acquire and edit can say
 * what happened to a lease instead of a bare "not_holder".
 *
 * The record is the feed, so it exists only for leases cleaned by a build that writes it, and it is
 * dropped from view once an archive pass hides the event. When it is missing, callers say less, never more.
 */

const LAPSE_EVENTS = "('lock_expired', 'lock_acquired', 'lock_released', 'lock_granted')";
const RECENT_EVENTS = 50;

const pad = (n) => String(n).padStart(2, '0');

/** HH:MM:SS in the local time zone. */
export const clockTime = (ms) => {
  const date = new Date(Number(ms));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const minutesAgo = (ms, now = Date.now()) => Math.max(0, Math.round((now - Number(ms)) / 60000));

const parseMeta = (row) => {
  try {
    return JSON.parse(row.metadata || '{}');
  } catch {
    return {};
  }
};

const expiredHolder = (row, meta) => {
  const hasHolder = typeof meta.holder === 'string' && meta.holder !== '';
  if (hasHolder) return meta.holder;
  const match = /held by (\S+) \(/.exec(row.message || '');
  return match ? match[1] : null;
};

// Does this feed row say something about holder's claim on the file?
const concernsHolder = (row, holder) => {
  const isExpiry = row.event_type === 'lock_expired';
  if (isExpiry) return expiredHolder(row, parseMeta(row)) === holder;
  const isGrant = row.event_type === 'lock_granted';
  if (isGrant) return row.recipient_id === holder;
  return row.author_id === holder;
};

const readEvents = (db, leaseKey) => {
  try {
    const sql = `SELECT * FROM agent_feed WHERE file_path = ? AND event_type IN ${LAPSE_EVENTS} ORDER BY id DESC LIMIT ${RECENT_EVENTS}`;
    return db.prepare(sql).all(leaseKey);
  } catch {
    return [];
  }
};

/**
 * The lapse of holder's lease on leaseKey, when the newest thing the feed says about holder and this
 * file is an expiry (so a later acquire, grant or release by holder cancels it).
 * @returns {{ expiredAt: number, noticedAt: number, reason: string } | null}
 */
export const findLapse = (db, leaseKey, holder) => {
  const newest = readEvents(db, leaseKey).find((row) => concernsHolder(row, holder));
  const isLapse = newest?.event_type === 'lock_expired';
  if (!isLapse) return null;
  const meta = parseMeta(newest);
  const expiredAt = Number(meta.expires_at) > 0 ? Number(meta.expires_at) : newest.timestamp;
  return { expiredAt, noticedAt: newest.timestamp, reason: meta.reason || 'TTL expired' };
};

export const describeLapse = (file, lapse, now = Date.now()) => {
  const when = `expired at ${clockTime(lapse.expiredAt)} (${minutesAgo(lapse.expiredAt, now)} min ago)`;
  return `lease on ${file} ${when}`;
};

/** Why release found no lease of the caller's, in one sentence that says who holds it now. */
export const explainNotHolder = (file, lapse, current, now = Date.now()) => {
  const hasCurrent = Boolean(current);
  const heldNow = hasCurrent ? `now held by ${current.locked_by} since ${clockTime(current.acquired_at)}` : 'nobody holds it now';
  if (lapse) return `${describeLapse(file, lapse, now)}; ${heldNow}`;
  if (hasCurrent) return `you do not hold a lease on ${file}; it is ${heldNow}`;
  return `you do not hold a lease on ${file}, and nobody else does`;
};
