/**
 * Story feed: /api/feed/story, meaningful events with lock churn rolled up (social sprint, epic #7614).
 * Contract shared by every cli/ui-social-*.js module; cli/ui-social-routes.js merges them:
 *   getRoutes(db, params, ctx) and postRoutes(db, body, ctx) return { '<exact path>': () => result };
 *   API_DOCS lists { path, about, params? } rows for GET /api/. ctx = { cwd, indexDb }.
 *   Optional getPatterns(db, params, ctx) / postPatterns(db, body, ctx) return [[regex, (match) => result]]
 *   for id paths such as /api/posts/<id>; exact routes and the built-in routes are tried first.
 *
 * The story view reads /api/feed rows newest-first in raw chunks and collapses each run of consecutive
 * NOISE_EVENTS by one author into one rollup row. A different author, or any other event, ends the run.
 * Keep NOISE_EVENTS in step with ChemxUi.NOISE_EVENTS in cli/ui-page/components/00-core.js.
 */
import { queryFeed } from './team/team-db.js';

export const NOISE_EVENTS = new Set(['lock_acquired', 'lock_released', 'lock_expired', 'guard-bypass']);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RAW_CHUNK = 200;

export const API_DOCS = [
  {
    path: '/api/feed/story',
    about: 'Feed posts oldest-first with lock and guard churn rolled up: consecutive lock_acquired, lock_released, lock_expired and guard-bypass events by one author become one row {eventType:"rollup", id, author, count, files, from, to}. limit counts story rows, so a page can cover many raw events; hasMore and oldestId page backwards with before_id.',
    params: 'limit (default 50, max 200, story rows), before_id (older page)'
  }
];

const isNoise = (row) => NOISE_EVENTS.has(row.event_type);

const startRollup = (row) => ({
  eventType: 'rollup', id: row.id, author: row.author_id, count: 0, files: [], from: row.timestamp, to: row.timestamp
});

const addToRollup = (rollup, row) => {
  const hasFile = Boolean(row.file_path) && !rollup.files.includes(row.file_path);
  return {
    ...rollup,
    count: rollup.count + 1,
    files: hasFile ? [...rollup.files, row.file_path] : rollup.files,
    from: Math.min(rollup.from, row.timestamp),
    to: Math.max(rollup.to, row.timestamp)
  };
};

/** Rows oldest-first in, story rows oldest-first out. A rollup's id is the id of its oldest event. */
export const rollUpRows = (rows) => {
  const out = [];
  let open = null;
  for (const row of rows) {
    const continuesRun = open !== null && isNoise(row) && open.author === row.author_id;
    const closesRun = !continuesRun && open !== null;
    if (closesRun) out.push(open);
    if (!isNoise(row)) {
      open = null;
      out.push(row);
    } else {
      open = addToRollup(continuesRun ? open : startRollup(row), row);
    }
  }
  if (open) out.push(open);
  return out;
};

const readLimit = (params) => {
  const n = Number(params.limit);
  const isValid = Number.isFinite(n) && n >= 1;
  return isValid ? Math.min(Math.floor(n), MAX_LIMIT) : DEFAULT_LIMIT;
};

/**
 * Reads raw chunks backwards until more than `limit` story rows exist (the extra row proves the oldest
 * kept row is complete) or the feed runs out. Returns the newest `limit` story rows, oldest-first.
 */
export const readStoryPage = (db, params = {}) => {
  const limit = readLimit(params);
  let rows = [];
  let beforeId = params.before_id;
  let isExhausted = false;
  while (!isExhausted && rollUpRows(rows).length <= limit) {
    const chunk = queryFeed(db, { limit: RAW_CHUNK, before_id: beforeId });
    isExhausted = chunk.length < RAW_CHUNK;
    rows = [...chunk, ...rows];
    beforeId = chunk.length > 0 ? chunk[0].id : beforeId;
  }
  const story = rollUpRows(rows);
  const feed = story.slice(-limit);
  return { success: true, feed, hasMore: story.length > limit, oldestId: feed.length > 0 ? feed[0].id : null };
};

export const getRoutes = (db, params = {}) => ({
  '/api/feed/story': () => readStoryPage(db, params)
});

export const postRoutes = () => ({});
