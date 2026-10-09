/**
 * Chemical X Protocol: what the coordination db says about a finished run (#2561).
 * Reads only (safeAll swallows a missing table). The db keeps no lease history except the feed, so every
 * answer here is bounded by what the feed still holds: a lease expiry is known only when a build that
 * writes lock_expired cleaned it and an archive pass has not hidden the event.
 *
 *   lapses     lock_expired events whose holder is a run handle and whose expiry fell inside that agent's
 *              activity window (transcript start..end). kind 'lapsed' = the holder edited the file after the
 *              expiry (a violation); kind 'benign' = no edit followed (information only, #2584). Expiry after the agent ended is `abandoned`: the
 *              agent left the lease behind, which is a release gap, not a lapse under an active holder.
 *   waiters    file_lock_queue rows of run handles; starved when never granted or granted later than starveMs.
 *   bypasses   guard-bypass feed events (the `# chemx-bypass: <reason>` log) authored by a run handle.
 *   leased     lock_acquired / lock_granted events per handle, for the edits-without-a-lease check.
 *
 * Limits: an agent's activity window is its first and last transcript entry, so a holder idle between two
 * commands is still "active"; handles shared by two agents are matched by window, else the first agent.
 */
import { safeAll } from './team-db-readonly.js';
import { DEFAULT_LEASE_CAP_MS } from './lease-cap.js';

const SLACK_MS = 15 * 60 * 1000;
const LOCK_EVENTS = "('lock_acquired','lock_granted','lock_released','lock_expired')";

const metaOf = (row) => {
  try {
    return JSON.parse(row.metadata || '{}');
  } catch {
    return {};
  }
};

const windowOf = (agents) => {
  const starts = agents.map((a) => a.startedAt).filter(Number.isFinite);
  const ends = agents.map((a) => a.endedAt).filter(Number.isFinite);
  const hasStamps = starts.length > 0 && ends.length > 0;
  return hasStamps ? { from: Math.min(...starts), to: Math.max(...ends) } : null;
};

const agentFor = (agents, handle, at) => {
  const mine = agents.filter((a) => a.handle === handle);
  const inWindow = mine.find((a) => a.startedAt <= at && at <= a.endedAt);
  return inWindow ?? mine[0] ?? null;
};

const lapseRows = (db, win) => safeAll(db, "SELECT * FROM agent_feed WHERE event_type = 'lock_expired' AND timestamp >= ? AND timestamp <= ? ORDER BY id", [win.from, win.to + SLACK_MS]);
const editMarks = (db) => new Map(safeAll(db, 'SELECT file_path, locked_by, edited_at FROM lease_edit_marks').map((m) => [`${m.file_path}\u0000${m.locked_by}`, m.edited_at]));

const lapseItem = (row, agent, marks) => {
  const meta = metaOf(row);
  const expiresAt = Number(meta.expires_at) || row.timestamp;
  const editedAt = marks.get(`${row.file_path}\u0000${meta.holder}`) ?? null;
  const isActive = agent.startedAt <= expiresAt && expiresAt <= agent.endedAt;
  const isEdited = editedAt !== null && editedAt > expiresAt;
  const activeKind = isEdited ? 'lapsed' : 'benign';
  return {
    kind: isActive ? activeKind : 'abandoned', file: row.file_path, handle: meta.holder, label: agent.label, agentId: agent.agentId,
    acquiredAt: Number(meta.acquired_at) || null, expiresAt, recordedAt: row.timestamp, purpose: meta.purpose || '',
    editedAfterLapse: isEdited
  };
};

export const leaseLapses = (db, agents) => {
  const win = windowOf(agents);
  if (!win) return [];
  const marks = editMarks(db);
  const items = [];
  for (const row of lapseRows(db, win)) {
    const holder = metaOf(row).holder;
    const agent = agentFor(agents, holder, Number(metaOf(row).expires_at) || row.timestamp);
    if (agent) items.push(lapseItem(row, agent, marks));
  }
  return items;
};

const holderAt = (events, at) => {
  let holder = null;
  for (const e of events) {
    const isLater = e.timestamp > at;
    if (isLater) break;
    const isTake = e.event_type === 'lock_acquired' || e.event_type === 'lock_granted';
    const who = e.event_type === 'lock_granted' ? e.recipient_id : e.author_id;
    holder = isTake ? who : null;
  }
  return holder;
};

/** Waiters of the run's agents. starved: never granted, or granted after starveMs. */
export const leaseWaiters = (db, agents, { starveMs = DEFAULT_LEASE_CAP_MS } = {}) => {
  const win = windowOf(agents);
  if (!win) return { total: 0, starved: [] };
  const queue = safeAll(db, 'SELECT * FROM file_lock_queue WHERE requested_at >= ? AND requested_at <= ? ORDER BY id', [win.from, win.to]);
  const mine = queue.filter((q) => agents.some((a) => a.handle === q.agent_id));
  const starved = [];
  for (const q of mine) {
    const events = safeAll(db, `SELECT * FROM agent_feed WHERE file_path = ? AND event_type IN ${LOCK_EVENTS} ORDER BY id`, [q.file_path]);
    const grant = events.find((e) => (e.event_type === 'lock_granted' ? e.recipient_id : e.author_id) === q.agent_id && e.timestamp >= q.requested_at && ['lock_granted', 'lock_acquired'].includes(e.event_type));
    const waitedMs = (grant ? grant.timestamp : win.to) - q.requested_at;
    const isStarved = !grant || waitedMs > starveMs;
    const agent = agentFor(agents, q.agent_id, q.requested_at);
    if (isStarved) starved.push({ file: q.file_path, waiter: q.agent_id, label: agent?.label ?? '', requestedAt: q.requested_at, waitedMs, granted: Boolean(grant), holder: holderAt(events, q.requested_at), status: q.status, purpose: q.purpose });
  }
  return { total: mine.length, starved };
};

const CRASH_GAP_MS = 2 * 60_000;

/**
 * guard-crash feed events (cli/hooks/entry.js) inside the run window, grouped into windows: events less than
 * CRASH_GAP_MS apart share one. A crash is not tied to a run handle (the hook may post as @claude), so every
 * crash in the window counts, and each window is an enforcement gap: the guard ran on its coarse fallback rules.
 * entry.js rate limits posts to one per minute per root, so `count` is a floor, not the number of crashed calls.
 */
export const guardCrashes = (db, agents) => {
  const win = windowOf(agents);
  if (!win) return [];
  const rows = safeAll(db, "SELECT * FROM agent_feed WHERE event_type = 'guard-crash' AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id", [win.from, win.to + SLACK_MS]);
  const windows = [];
  for (const r of rows) {
    const meta = metaOf(r);
    const last = windows[windows.length - 1];
    const isSame = last !== undefined && r.timestamp - last.to < CRASH_GAP_MS;
    const target = isSame ? last : { from: r.timestamp, to: r.timestamp, count: 0, hooks: [], errors: [] };
    const isNew = !isSame;
    if (isNew) windows.push(target);
    target.to = r.timestamp;
    target.count += 1;
    const error = meta.error ?? r.message;
    const isNewHook = Boolean(meta.hook) && !target.hooks.includes(meta.hook);
    const isNewError = !target.errors.includes(error);
    target.hooks.push(...(isNewHook ? [meta.hook] : []));
    target.errors.push(...(isNewError ? [error] : []));
  }
  return windows;
};

/** guard-bypass feed events by run handles inside the run window. */
export const guardBypasses = (db, agents) => {
  const win = windowOf(agents);
  if (!win) return [];
  const rows = safeAll(db, "SELECT * FROM agent_feed WHERE event_type = 'guard-bypass' AND timestamp >= ? AND timestamp <= ? ORDER BY id", [win.from, win.to + SLACK_MS]);
  return rows.filter((r) => agents.some((a) => a.handle === r.author_id)).map((r) => {
    const meta = metaOf(r);
    return { handle: r.author_id, at: r.timestamp, rule: meta.rule ?? null, reason: meta.reason ?? r.message, command: meta.command ?? '' };
  });
};

/** Leases each run handle took, as { handle -> [{ file, at }] } from the feed. */
export const leasesTaken = (db, agents) => {
  const win = windowOf(agents);
  const taken = new Map();
  if (!win) return taken;
  const rows = safeAll(db, "SELECT * FROM agent_feed WHERE event_type IN ('lock_acquired','lock_granted') AND timestamp >= ? AND timestamp <= ? ORDER BY id", [win.from, win.to]);
  for (const r of rows) {
    const who = r.event_type === 'lock_granted' ? r.recipient_id : r.author_id;
    const list = taken.get(who) ?? [];
    list.push({ file: r.file_path, at: r.timestamp });
    taken.set(who, list);
  }
  return taken;
};

/** Status of task ids from agent_tasks; ids it does not know are absent. */
export const taskStatuses = (db, ids) => {
  const statuses = new Map();
  for (const id of ids) {
    const [row] = safeAll(db, 'SELECT status FROM agent_tasks WHERE id = ?', [id]);
    if (row) statuses.set(id, row.status);
  }
  return statuses;
};
