/**
 * Chemical X Protocol: the one-line answer `chemx team lock` prints per path (#6747).
 *   ✔ <path> granted until HH:MM
 *   ⏳ <path> queued behind @holder (position N, holder notified)
 *   ✕ <path> refused: <reason>
 * followed, once per call and only when something was granted, by the renewal note. Every path gets
 * exactly one line on stdout, in the order given, so a batch reads as a table.
 */
import { clockTime } from './lease-lapse.js';
import { DEFAULT_TTL_MS } from './team-db-lock-promotion.js';

export const RENEWAL_NOTE = `Any chemx command run as this handle extends it to ${DEFAULT_TTL_MS / 60000} minutes from then; with no chemx activity it lapses. If someone queues for it, renewal stops after the cap (10 minutes by default) since your last edit of the file (docs/team-locks.md).`;

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const hhmm = (ms) => clockTime(ms).slice(0, 5);

// The holder notice (#2566), short: exact about what was sent, never more.
const holderNotice = (res) => {
  const isNotified = Boolean(res.holderNotified);
  if (!isNotified) return 'holder not notified: ask them to release it';
  return res.noticeSent ? 'holder notified' : 'holder already notified';
};

const lapseNote = (res) => (res.previousLapse ? ` (your earlier lease expired ${clockTime(res.previousLapse.expiredAt)})` : '');

const grantedLine = (file, res) => `${GREEN}✔${RESET} ${file} granted until ${hhmm(res.lease.expires_at)}${lapseNote(res)}`;

const queuedLine = (file, res) => `${YELLOW}⏳${RESET} ${file} ${res.requeued ? 'still queued' : 'queued'} behind ${res.currentHolder} (position ${res.position}, ${holderNotice(res)})`;

// db-layer messages open with the path; the line already names it.
const refusalText = (file, res) => {
  const text = res.message || res.reason || 'not granted';
  return text.startsWith(`${file} `) ? text.slice(file.length + 1) : text;
};

const refusedLine = (file, res) => `${RED}✕${RESET} ${file} refused: ${refusalText(file, res)}`;

const LINE_BY_OUTCOME = { granted: grantedLine, queued: queuedLine, refused: refusedLine };

/** granted | queued | refused */
export const outcomeOf = (res) => {
  if (res.granted) return 'granted';
  return res.queued ? 'queued' : 'refused';
};

export const lockLine = (file, res) => LINE_BY_OUTCOME[outcomeOf(res)](file, res);

/** Counts per outcome over [{ file, ...res }]. */
export const summarize = (results) => {
  const summary = { granted: 0, queued: 0, refused: 0 };
  for (const res of results) summary[outcomeOf(res)] += 1;
  return summary;
};
