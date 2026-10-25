/**
 * Chemical X Protocol: the cheap way to read the swarm feed (K4, #6749).
 * Type groups, one-line rendering and the filter the `team feed` command and the chemx_team_feed MCP
 * tool share. Guaranteed: a one-line view never carries more than ONELINE_CHARS of a message (plus an
 * ellipsis) and never a newline. Not guaranteed: the groups name the event types chemx writes today; a
 * type another tool invents is reachable only by its exact name.
 */

export const DEFAULT_FEED_LIMIT = 20;
export const ONELINE_CHARS = 120;

/**
 * lock: every lock_* event. task: every task_* event (created, status_updated, complete, handoff, closed).
 * status: status lines and task comments. post: what agents broadcast to each other.
 */
const FEED_TYPE_GROUPS = Object.freeze({
  lock: { event_type_prefixes: ['lock_'] },
  task: { event_type_prefixes: ['task_'] },
  status: { event_types: ['status', 'status_update', 'task_status_updated', 'progress', 'heartbeat'] },
  post: { event_types: ['broadcast', 'mention', 'decision', 'blocker', 'dm'] }
});

/** @returns {{event_types?: string[], event_type_prefixes?: string[]}} what queryFeed filters on; {} for no filter */
export const resolveFeedTypeFilter = (raw) => {
  const names = String(raw ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const filter = {};
  for (const name of names) {
    const group = Object.hasOwn(FEED_TYPE_GROUPS, name) ? FEED_TYPE_GROUPS[name] : { event_types: [name] };
    for (const [key, values] of Object.entries(group)) filter[key] = [...new Set([...(filter[key] ?? []), ...values])];
  }
  return filter;
};

/** One line: whitespace folded, cut at `max` characters with an ellipsis. */
export const clipText = (text, max = ONELINE_CHARS) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const isShort = flat.length <= max;
  return isShort ? flat : `${flat.slice(0, max).trimEnd()}…`;
};

/** The queryFeed filter for the CLI flags or the MCP arguments (both pass the same neutral names). */
export const buildFeedFilter = ({ since, thread, task, type, agent, from, limit }, defaultLimit = DEFAULT_FEED_LIMIT) => ({
  since_id: since,
  thread_id: thread,
  task_id: task,
  agent_id: agent,
  author_id: from,
  limit: limit || defaultLimit,
  ...resolveFeedTypeFilter(type)
});

const clock = (timestamp) => new Date(timestamp).toTimeString().slice(0, 5);

/** `#id HH:MM @author [➔ @to] [type] message`, one line, no colour. */
export const formatFeedLine = (ev) => {
  const to = ev.recipient_id ? ` ➔ ${ev.recipient_id}` : '';
  return `#${ev.id} ${clock(ev.timestamp)} ${ev.author_id}${to} [${ev.event_type}] ${clipText(ev.message)}`;
};

/** The newest events as one-liners, with a closing hint when the page is full and may hide older ones. */
export const formatFeedOneLines = (events = [], limit = DEFAULT_FEED_LIMIT) => {
  const isEmpty = events.length === 0;
  if (isEmpty) return '(no feed events match)\n';
  const lines = events.map(formatFeedLine);
  const isFull = events.length >= limit;
  if (isFull) lines.push(`(${events.length} shown; --limit=N for more, --since=<id> for newer, --full for whole messages)`);
  return `${lines.join('\n')}\n`;
};

/** Events with the message cut to one line, for the JSON and MCP views that ask for it. */
export const clipEvents = (events = []) => events.map((ev) => ({ ...ev, message: clipText(ev.message) }));
