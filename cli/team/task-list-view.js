import { toColumnar } from '../columnar.js';

export const DEFAULT_LIST_STATUSES = ['queued', 'in_progress', 'review', 'blocked', 'pending_approval'];
export const DEFAULT_LIST_LIMIT = 20;
const TITLE_MAX = 48;
const LIST_COLUMNS = ['id', 'status', 'priority', 'assigned_agent_id', 'title'];

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

export const resolveListOptions = ({ status, all, limit } = {}) => {
  const isAll = Boolean(all);
  const explicitLimit = toPositiveLimit(limit);
  const statuses = status ? [status] : DEFAULT_LIST_STATUSES;
  return {
    status: isAll ? undefined : status,
    statuses: isAll ? null : statuses,
    limit: explicitLimit ?? (isAll ? null : DEFAULT_LIST_LIMIT)
  };
};

export const selectTaskPage = (tasks, { statuses, limit }) => {
  const matching = statuses ? tasks.filter((t) => statuses.includes(t.status)) : tasks;
  const newestFirst = [...matching].sort((a, b) => b.id - a.id);
  const page = limit ? newestFirst.slice(0, limit) : newestFirst;
  return { page, total: matching.length };
};

export const buildTaskListView = (page, total) => {
  const col = toColumnar(page, LIST_COLUMNS, { title: truncateTitle });
  const hasMore = total > page.length;
  const hint = hasMore ? `showing ${page.length} of ${total}; use --all, --status=, or --limit=` : undefined;
  return { ...col, total, ...(hint ? { hint } : {}) };
};
