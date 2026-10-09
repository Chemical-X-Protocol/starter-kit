/**
 * Chemical X Protocol: token-bounded text for agent profiles and the session team brief.
 * Every list shows its count and at most a few items; every free-text field is clipped.
 */

export const PROFILE_BRIEF_MAX_CHARS = 900;
const TOP_ITEMS = 3;
const TITLE_CHARS = 48;
const MESSAGE_CHARS = 120;
const HANDOFF_CHARS = 240;

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export const clip = (text, maxChars) => {
  const flat = oneLine(text);
  const fits = flat.length <= maxChars;
  if (fits) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 3))}...`;
};

export const formatAgo = (timestamp, now = Date.now()) => {
  const hasTime = Number.isFinite(timestamp) && timestamp > 0;
  if (!hasTime) return 'never';
  const minutes = Math.max(0, Math.round((now - timestamp) / 60000));
  const isUnderAnHour = minutes < 60;
  if (isUnderAnHour) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  const isRecent = hours < 48;
  if (isRecent) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const formatDate = (timestamp) => {
  const hasTime = Number.isFinite(timestamp) && timestamp > 0;
  if (!hasTime) return 'unknown';
  return new Date(timestamp).toISOString().slice(0, 10);
};

/** "a, b, c +2 more" from a { count, items } list. */
export const listTop = (list, render, top = TOP_ITEMS) => {
  const shown = (list?.items ?? []).slice(0, top).map(render);
  const hidden = Number(list?.count ?? 0) - shown.length;
  const hasHidden = hidden > 0;
  if (hasHidden) shown.push(`+${hidden} more`);
  return shown.join(', ');
};

/** Keeps whole lines while they fit; the first line that does not fit is clipped and ends the text. */
export const capLines = (lines, maxChars) => {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const separator = kept.length > 0 ? 1 : 0;
    const room = maxChars - used - separator;
    const fits = line.length <= room;
    if (fits) {
      kept.push(line);
      used += line.length + separator;
      continue;
    }
    const hasRoom = room > 3;
    if (hasRoom) kept.push(clip(line, room));
    break;
  }
  return kept.join('\n');
};

const renderTask = (task) => `#${task.id} ${clip(task.title, TITLE_CHARS)} [${task.status}]`;
const renderLock = (lock) => lock.file;

const countedLine = (label, list, render) => {
  const count = Number(list?.count ?? 0);
  const isEmpty = count === 0;
  if (isEmpty) return null;
  return `${label} ${count}: ${listTop(list, render)}`;
};

const unreadLine = (unread) => {
  const count = Number(unread?.count ?? 0);
  const isEmpty = count === 0;
  if (isEmpty) return null;
  const latest = unread.items[0];
  const hasLatest = Boolean(latest);
  if (!hasLatest) return `Unread DMs ${count}.`;
  return `Unread DMs ${count}; latest from ${latest.from}: "${clip(latest.message, MESSAGE_CHARS)}"`;
};

const decisionsLine = (decisions) => {
  const items = decisions?.items ?? [];
  const isEmpty = items.length === 0;
  if (isEmpty) return null;
  return `Decisions ${decisions.count}: ${items.slice(0, 2).map((row) => `"${clip(row.message, MESSAGE_CHARS)}"`).join('; ')}`;
};

export const handoffLine = (handoff, now = Date.now()) => {
  const hasHandoff = Boolean(handoff);
  if (!hasHandoff) return null;
  const hasTask = Boolean(handoff.taskId);
  const taskNote = hasTask ? `, #${handoff.taskId}` : '';
  return `Handoff (${handoff.from}, ${formatAgo(handoff.at, now)}${taskNote}): ${clip(handoff.message, HANDOFF_CHARS)}`;
};

const activityLine = (activity) => {
  const total = Number(activity?.total ?? 0);
  const isEmpty = total === 0;
  if (isEmpty) return 'Activity: none recorded.';
  const types = (activity.byType ?? []).slice(0, TOP_ITEMS).map((row) => `${row.type} ${row.count}`).join(', ');
  return `Activity: ${total} events (${types}).`;
};

export const formatProfileBrief = (profile, { maxChars = PROFILE_BRIEF_MAX_CHARS, now = Date.now() } = {}) => {
  const hasProfile = Boolean(profile?.handle);
  if (!hasProfile) return '';
  const header = `${profile.handle} | first seen ${formatDate(profile.firstSeen)} | last seen ${formatAgo(profile.lastSeen, now)}`;
  const lines = [
    header,
    countedLine('Claims', profile.claims, renderTask),
    countedLine('Queued for me', profile.queuedForMe, renderTask),
    countedLine('Live locks', profile.liveLocks, renderLock),
    unreadLine(profile.unreadDms),
    decisionsLine(profile.recentDecisions),
    handoffLine(profile.latestHandoff, now),
    activityLine(profile.recentActivity),
  ].filter(Boolean);
  return capLines(lines, maxChars);
};
