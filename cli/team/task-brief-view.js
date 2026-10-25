/**
 * Chemical X Protocol: the short views of a task (K4, #6749).
 * `task show --brief` (header facts plus only what was posted after the task was created), the creation
 * event as one line in the full card, and the one-line acks for `task add` and `task comment`.
 * Guaranteed: a brief never prints the description, and a creation event that only repeats the title
 * prints nothing but its author. Not guaranteed: "newer than the description" means every event after
 * the task_created event; the description has no edit history of its own.
 */

import { clipText } from './team-feed-view.js';

const BRIEF_TITLE_CHARS = 160;
const ACK_TITLE_CHARS = 100;
const NOTE_CHARS = 120;
const CREATED_ECHO = /^Created task #\d+: /;

const clock = (timestamp) => new Date(timestamp).toTimeString().slice(0, 5);

/** `#<id> added: <title>`: the id first so a caller can read it without a list, the title cut to one line, the repo named unless it is the root. */
export const describeTaskAdded = (task) => {
  const isRootRepo = !task.repo || task.repo === '.';
  const where = isRootRepo ? '' : ` (repo ${task.repo})`;
  return `#${task.id} added: ${clipText(task.title, ACK_TITLE_CHARS)}${where}`;
};

/** `#<task>: comment <event id> posted`: the event id works as a `team feed --since=` cursor. */
export const describeCommentPosted = (taskId, ev) => `#${taskId}: comment ${ev.id} posted`;

/** The task row without its description: what an ack or a brief needs. */
export const slimTask = (task) => {
  const { description, ...rest } = task;
  return { ...rest, descriptionChars: String(description ?? '').trim().length };
};

const SLIM_ACK_FIELDS = ['id', 'title', 'status', 'priority', 'needs', 'tier', 'repo', 'target_path', 'parent_id', 'assigned_agent_id'];

/** The fields a `task add` ack prints for --json and returns over MCP. */
export const taskAckFields = (task) => Object.fromEntries(SLIM_ACK_FIELDS.map((field) => [field, task[field]]));

/** The creation event's trailing text: nothing when it only echoes the title, else its first line clipped. */
export const describeCreationNote = (ev, task) => {
  const message = String(ev.message ?? '');
  const isEcho = CREATED_ECHO.test(message) && message.replace(CREATED_ECHO, '') === String(task?.title ?? '');
  return isEcho ? '' : ` ${clipText(message, NOTE_CHARS)}`;
};

/** Events posted after the task was created: its comments and status changes, not the creation line. */
export const eventsAfterCreation = (events = []) => {
  const created = events.find((ev) => ev.event_type === 'task_created');
  const createdId = created ? created.id : 0;
  return events.filter((ev) => ev.event_type !== 'task_created' && ev.id > createdId);
};

export const buildBriefView = (task, events = [], dependencyStates = []) => {
  const newer = eventsAfterCreation(events);
  return { task: slimTask(task), dependencyStates, events: newer, activityCount: events.length };
};

const factsLine = (task) => {
  const parent = task.parent_id ? ` · parent #${task.parent_id}` : '';
  return `  tier ${task.tier || '(none)'} · needs ${task.needs || '(none)'} · P${task.priority || 2} · ${task.assigned_agent_id || '(unassigned)'}${parent}`;
};

const commentLines = (newer) => {
  const hasNone = newer.length === 0;
  if (hasNone) return ['  no comments since the description'];
  const lines = [`  since the description (${newer.length}):`];
  for (const ev of newer) {
    const body = String(ev.message ?? '').trim().replace(/\n/g, '\n        ');
    lines.push(`    #${ev.id} ${clock(ev.timestamp)} ${ev.author_id}: ${body}`);
  }
  return lines;
};

/** Title, status, tier, assignee, dependencies, parent and the comments after the description. */
export const formatTaskBriefCard = (task, events = [], dependencyStates = []) => {
  const lines = [`#${task.id} [${task.status}] ${clipText(task.title, BRIEF_TITLE_CHARS)}`, factsLine(task)];
  const hasTarget = Boolean(task.target_path);
  if (hasTarget) lines.push(`  target: ${task.target_path}`);
  const hasBlocker = Boolean(task.blocked_reason);
  if (hasBlocker) lines.push(`  blocker: ${task.blocked_reason}`);
  const hasDependencies = dependencyStates.length > 0;
  if (hasDependencies) lines.push(`  deps: ${dependencyStates.map((dep) => `#${dep.id} [${dep.status}] ${clipText(dep.title, 60)}`).join(', ')}`);
  const descriptionChars = String(task.description ?? '').trim().length;
  const hasDescription = descriptionChars > 0;
  if (hasDescription) lines.push(`  description hidden (${descriptionChars} chars): drop --brief to read it`);
  lines.push(...commentLines(eventsAfterCreation(events)));
  return `${lines.join('\n')}\n`;
};
