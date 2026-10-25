import { toColumnar } from '../columnar.js';
import { kindTag } from './task-kind.js';

export const DEFAULT_LIST_STATUSES = ['queued', 'in_progress', 'review', 'blocked', 'pending_approval'];
export const DEFAULT_LIST_LIMIT = 20;
const TITLE_MAX = 48;
const LIST_COLUMNS = ['id', 'status', 'priority', 'assigned_agent_id', 'title'];
// --titles: the bare view, id, status and the whole title.
const TITLES_COLUMNS = ['id', 'status', 'title'];
// Columns that appear only once a listed task needs them, so plain lists stay compact: the capability tier,
// the kind of a decision or an epic, and the hours a claim has been idle (task-claim-age.js).
const OPTIONAL_COLUMNS = [
  { name: 'kind', after: 'id', applies: (task) => Boolean(task.kind) && task.kind !== 'task' },
  { name: 'needs', after: 'priority', applies: (task) => Boolean(task.needs) },
  { name: 'idle_hours', after: 'assigned_agent_id', applies: (task) => Number.isInteger(task.idle_hours) }
];

const truncateTitle = (task) => {
  const title = task.title ?? '';
  const isLong = title.length > TITLE_MAX;
  return isLong ? `${title.slice(0, TITLE_MAX - 3)}...` : title;
};

const toPositiveLimit = (limit) => {
  const parsed = Number(limit);
  const isUsable = Number.isInteger(parsed) && parsed > 0;
  return isUsable ? parsed : null;
};

// A --search looks in every status unless --status narrows it; the row cap stays unless --all or --limit lifts it.
export const resolveListOptions = ({ status, all, limit, search } = {}) => {
  const isAll = Boolean(all);
  const searchesEveryStatus = Boolean(search) && !status;
  const explicitLimit = toPositiveLimit(limit);
  const statuses = status ? [status] : DEFAULT_LIST_STATUSES;
  return {
    status: isAll ? undefined : status,
    statuses: isAll || searchesEveryStatus ? null : statuses,
    limit: explicitLimit ?? (isAll ? null : DEFAULT_LIST_LIMIT)
  };
};

export const selectTaskPage = (tasks, { statuses, limit }) => {
  const matching = statuses ? tasks.filter((t) => statuses.includes(t.status)) : tasks;
  const newestFirst = [...matching].sort((a, b) => b.id - a.id);
  const page = limit ? newestFirst.slice(0, limit) : newestFirst;
  return { page, total: matching.length };
};

const listColumnsFor = (page, base) => {
  const wanted = OPTIONAL_COLUMNS.filter((column) => base.includes(column.after) && page.some(column.applies));
  return wanted.reduce((columns, column) => {
    const insertAt = columns.indexOf(column.after) + 1;
    return [...columns.slice(0, insertAt), column.name, ...columns.slice(insertAt)];
  }, base);
};

/** options.titles: columns id, status and the whole title (plus kind, idle_hours when they apply). */
export const buildTaskListView = (page, total, { titles = false } = {}) => {
  const base = titles ? TITLES_COLUMNS : LIST_COLUMNS;
  const col = toColumnar(page, listColumnsFor(page, base), titles ? {} : { title: truncateTitle });
  const hasMore = total > page.length;
  const hint = hasMore ? `showing ${page.length} of ${total}; use --all, --status=, or --limit=` : undefined;
  return { ...col, total, ...(hint ? { hint } : {}) };
};

/** `--titles` in text: `#<id> [<kind>] [<status>] <title>`, one line per task, no tree, assignee, target or description. */
export const formatTitleLines = (page) => {
  const hasNoTasks = page.length === 0;
  if (hasNoTasks) return '  (No tasks found.)\n';
  const lines = page.map((task) => `#${task.id}${kindTag(task)} [${task.status}] ${String(task.title ?? '').replace(/\s+/g, ' ').trim()}`);
  return `${lines.join('\n')}\n`;
};
