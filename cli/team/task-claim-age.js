/**
 * Chemical X Protocol: how long a claim has run and how long its assignee has been quiet (K14, #6759).
 * `task show` prints claimed_at and the assignee's last activity; `task list` marks a claim idle for more
 * than IDLE_AFTER_MS with "idle Nh". A claim is a task that is in_progress with an assignee.
 * Guaranteed: the last activity is the freshest of the agent's heartbeat, its latest feed post and its live
 * leases (a lease is renewed by any chemx call of its holder, so a live one means active), and an idle claim
 * counts the task's own claimed_at and updated_at as signs of life too. Not guaranteed: an agent that works
 * without calling chemx or posting looks idle; a claim made before claimed_at existed has no claim time.
 */
import { DEFAULT_TTL_MS } from './team-db-lock-promotion.js';

const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
export const IDLE_AFTER_MS = 6 * HOUR_MS;

const isLiveClaim = (task) => task?.status === 'in_progress' && Boolean(task.assigned_agent_id);

const holes = (handles) => handles.map(() => '?').join(', ');

const note = (seen, handle, at) => {
  const stamp = Number(at);
  const isNewer = Number.isFinite(stamp) && stamp > (seen.get(handle) ?? 0);
  if (isNewer) seen.set(handle, stamp);
};

/** A live lease is renewed to now + TTL by any chemx call of its holder, so the last call was about TTL before its expiry. */
const leaseActivity = (lease, now) => Math.min(now, Math.max(Number(lease.acquired_at), Number(lease.expires_at) - DEFAULT_TTL_MS));

/** @returns {Map<string, number>} handle -> ms timestamp of its freshest sign of life; a handle never seen is absent */
export const lastActivityByHandle = (db, handles, now = Date.now()) => {
  const seen = new Map();
  const wanted = [...new Set(handles.filter(Boolean))];
  const hasNothingToRead = !db || wanted.length === 0;
  if (hasNothingToRead) return seen;
  const marks = holes(wanted);
  for (const row of db.prepare(`SELECT id AS handle, heartbeat AS at FROM agents WHERE id IN (${marks})`).all(...wanted)) note(seen, row.handle, row.at);
  for (const row of db.prepare(`SELECT author_id AS handle, MAX(timestamp) AS at FROM agent_feed WHERE author_id IN (${marks}) GROUP BY author_id`).all(...wanted)) note(seen, row.handle, row.at);
  const leases = db.prepare(`SELECT locked_by AS handle, acquired_at, expires_at FROM file_leases WHERE locked_by IN (${marks}) AND expires_at > ?`).all(...wanted, now);
  for (const lease of leases) note(seen, lease.handle, leaseActivity(lease, now));
  return seen;
};

/** Whole hours a live claim has been quiet when that is more than IDLE_AFTER_MS, else null. */
export const idleHoursOf = (task, lastActive, now = Date.now()) => {
  if (!isLiveClaim(task)) return null;
  const freshest = Math.max(lastActive ?? 0, Number(task.claimed_at ?? 0), Number(task.updated_at ?? 0));
  const quietMs = now - freshest;
  const isIdle = quietMs > IDLE_AFTER_MS;
  return isIdle ? Math.floor(quietMs / HOUR_MS) : null;
};

/** The tasks with idle_hours added to each idle claim; every other task is returned as it was. */
export const markIdleClaims = (db, tasks, now = Date.now()) => {
  const seen = lastActivityByHandle(db, tasks.filter(isLiveClaim).map((task) => task.assigned_agent_id), now);
  return tasks.map((task) => {
    const hours = idleHoursOf(task, seen.get(task.assigned_agent_id), now);
    return hours === null ? task : { ...task, idle_hours: hours };
  });
};

/** @returns {{ handle: string, claimedAt: number|null, lastActiveAt: number|null, idleHours: number|null } | null} null unless the task is a live claim */
export const claimInfoFor = (db, task, now = Date.now()) => {
  if (!isLiveClaim(task)) return null;
  const handle = task.assigned_agent_id;
  const lastActiveAt = lastActivityByHandle(db, [handle], now).get(handle) ?? null;
  return { handle, claimedAt: task.claimed_at ?? null, lastActiveAt, idleHours: idleHoursOf(task, lastActiveAt, now) };
};

const pad = (value) => String(value).padStart(2, '0');

const DAY_MS = 24 * HOUR_MS;
const SINCE_STEPS = [
  { below: MINUTE_MS, say: () => 'just now' },
  { below: 100 * MINUTE_MS, say: (ms) => `${Math.round(ms / MINUTE_MS)}m ago` },
  { below: 48 * HOUR_MS, say: (ms) => `${Math.floor(ms / HOUR_MS)}h ago` }
];

const sinceText = (ms) => {
  const step = SINCE_STEPS.find((candidate) => ms < candidate.below);
  return step ? step.say(ms) : `${Math.floor(ms / DAY_MS)}d ago`;
};

/** `2026-10-25 12:40 (3h ago)` in local time. */
export const describeWhen = (timestamp, now = Date.now()) => {
  const at = new Date(timestamp);
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())} (${sinceText(Math.max(0, now - timestamp))})`;
};

const claimedText = (info, now) => (info.claimedAt === null ? '(time not recorded)' : describeWhen(info.claimedAt, now));
const activeText = (info, now) => (info.lastActiveAt === null ? '(never seen)' : describeWhen(info.lastActiveAt, now));

/** The detail card line: `Claimed: <when> │ Last active: <when> [│ idle Nh]`. */
export const formatClaimLine = (info, now = Date.now()) => {
  const idle = info.idleHours === null ? '' : ` │ idle ${info.idleHours}h`;
  return `Claimed:  ${claimedText(info, now)} │ Last active: ${activeText(info, now)}${idle}`;
};

/** The brief card line: `claimed <when> · <handle> last active <when> [· idle Nh]`. */
export const formatClaimBriefLine = (info, now = Date.now()) => {
  const idle = info.idleHours === null ? '' : ` · idle ${info.idleHours}h`;
  return `claimed ${claimedText(info, now)} · ${info.handle} last active ${activeText(info, now)}${idle}`;
};
