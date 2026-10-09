/**
 * Chemical X Protocol: telling a lease holder that someone is queued behind them (#2566).
 * One direct message per (file, waiter, holder), sent the first time the waiter queues. A repeat poll
 * by the same waiter sends nothing but still reports that the holder was told. The message is a plain
 * `dm` in the feed (chemx team inbox shows it) carrying metadata.kind = 'lease_waiter'.
 * Limit: the holder reads it only when it checks its inbox; the notice does not interrupt a running agent.
 */
import { sendDirectMessage } from './team-db-mailbox.js';
import { clockTime } from './lease-lapse.js';
import { lastEditAt, leaseCapMs } from './lease-cap.js';

const SENT_SQL = `SELECT 1 AS sent FROM agent_feed WHERE event_type = 'dm' AND author_id = ? AND recipient_id = ?
  AND json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.kind') = 'lease_waiter'
  AND json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.file') = ? LIMIT 1`;

const hhmm = (ms) => clockTime(ms).slice(0, 5);

/** The notice text: names the waiter, the file, since when, the release path and the exact cap rule. */
export const noticeText = ({ waiter, holder, file, since, capAt, capMs }) => [
  `${waiter} is waiting for ${file} since ${hhmm(since)}; commit and release it when your edit is in`,
  `(chemx commit <files> -m "<msg>" --release, or chemx team lock release ${file} --as=${holder}).`,
  `While anyone waits, chemx stops extending that lease ${Math.round(capMs / 60000)} min after your last edit of the file`,
  `(from ${clockTime(capAt)}); once it lapses the file goes to the first waiter and your edit of it is refused.`
].join(' ');

/**
 * @param {object} db Writable team db (inside the caller's transaction).
 * @param {{ queueId: number, waiter: string, lease: object, options?: object }} args lease = the holder's file_leases row.
 * @returns {{ holderNotified: boolean, noticeSent: boolean, notifiedHolder: string }} Never throws: a failed send reports holderNotified false.
 */
export const notifyHolderOfWaiter = (db, { queueId, waiter, lease, options = {} }) => {
  const holder = lease.locked_by;
  try {
    const alreadySent = Boolean(db.prepare(SENT_SQL).get(waiter, holder, lease.file_path));
    if (alreadySent) return { holderNotified: true, noticeSent: false, notifiedHolder: holder };
    const entry = db.prepare('SELECT requested_at FROM file_lock_queue WHERE id = ?').get(queueId);
    const since = Number(entry?.requested_at) || Date.now();
    const capMs = leaseCapMs(options);
    const capAt = lastEditAt(db, lease) + capMs;
    const message = noticeText({ waiter, holder, file: lease.file_path, since, capAt, capMs });
    sendDirectMessage(db, { author_id: waiter, recipient_id: holder, message, metadata: { kind: 'lease_waiter', file: lease.file_path, since, capAt } });
    return { holderNotified: true, noticeSent: true, notifiedHolder: holder };
  } catch (err) {
    const isDebug = Boolean(process.env.CHEMX_DEBUG);
    if (isDebug) process.stderr.write(`[lease-waiter-notice] skipped: ${err.message}\n`);
    return { holderNotified: false, noticeSent: false, notifiedHolder: holder };
  }
};
