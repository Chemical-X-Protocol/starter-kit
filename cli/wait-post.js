/**
 * chemx wait --post-matching <text> [--from=@handle] [--since=<event id>] (K14, #6759): the feed condition.
 * Guaranteed: a match is a feed event with an id above the cursor whose message contains the text (any case),
 * from that handle when --from is given, and not a lock event (lock_* messages are file names, not posts).
 * Without --since the cursor is the newest event when the wait starts, so only posts made after that count.
 * Read-only on the board of the cwd (the same db `chemx team feed` reads). Not guaranteed: a post archived
 * later still counted when it was seen; archived events are never matched.
 */
import { resolveTeamDbTarget } from './team/coordination-target.js';
import { openTeamDbReadOnly, closeQuietly, safeAll, safeGet } from './team/team-db-readonly.js';
import { NOT_ARCHIVED_SQL } from './team/team-db-feed.js';
import { clipText } from './team/team-feed-view.js';

const withFeed = (cwd, read) => {
  const target = resolveTeamDbTarget(cwd);
  const db = target.refused ? null : openTeamDbReadOnly(target.root);
  const hasDb = Boolean(db);
  if (!hasDb) return null;
  try {
    return read(db);
  } finally {
    closeQuietly(db);
  }
};

/** The newest feed event id of the board that serves cwd (0 when there is none). */
export const latestEventId = (cwd) => withFeed(cwd, (db) => Number(safeGet(db, 'SELECT MAX(id) AS id FROM agent_feed')?.id ?? 0)) ?? 0;

const POSTS_SQL = `SELECT id, author_id, event_type, message FROM agent_feed WHERE id > ? AND event_type NOT LIKE 'lock\\_%' ESCAPE '\\' AND ${NOT_ARCHIVED_SQL}`;

/** The first feed event after `since` that matches, or null. */
export const findMatchingPost = (cwd, { text, from, since }) => withFeed(cwd, (db) => {
  const hasAuthor = Boolean(from);
  const rows = safeAll(db, `${POSTS_SQL}${hasAuthor ? ' AND author_id = ?' : ''} ORDER BY id ASC`, hasAuthor ? [since, from] : [since]);
  const needle = text.toLowerCase();
  return rows.find((row) => String(row.message).toLowerCase().includes(needle)) ?? null;
});

/** One poll: { done, note } for the post condition. */
export const checkPost = (opts, cwd) => {
  const hit = findMatchingPost(cwd, { text: opts.postMatching, from: opts.from, since: opts.since });
  if (hit) return { done: true, note: `post #${hit.id} by ${hit.author_id} [${hit.event_type}] matches "${opts.postMatching}": ${clipText(hit.message)}` };
  const fromNote = opts.from ? ` from ${opts.from}` : '';
  return { done: false, note: `no post matching "${opts.postMatching}"${fromNote} after event #${opts.since}` };
};
