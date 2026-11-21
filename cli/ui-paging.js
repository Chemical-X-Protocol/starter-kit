/**
 * Paging core for the chemx UI and its HTTP clients, human or agent (#7604).
 * Every paged list answers with one envelope: { total, limit, offset, page, totalPages, hasMore, nextOffset }.
 * The reads themselves: ui-paging-tasks.js (tasks, board) and ui-paging-agents.js (agents).
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
export const BOARD_COLUMNS = ['queued', 'in_progress', 'review', 'done', 'blocked'];

export const isTruthyFlag = (value) => value === true || value === '1' || value === 'true';

const toInt = (value) => {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : null;
};

/** limit (clamped to 1..200, default fallback) and offset; page=N works instead of offset. */
export const readPageParams = (params = {}, fallback = DEFAULT_PAGE_SIZE) => {
  const rawLimit = toInt(params.limit ?? params.pageSize);
  const limit = rawLimit === null ? fallback : Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  const rawOffset = toInt(params.offset);
  const page = toInt(params.page);
  const pageOffset = page !== null && page > 1 ? (page - 1) * limit : 0;
  const offset = rawOffset === null ? pageOffset : Math.max(0, rawOffset);
  return { limit, offset };
};

export const pageEnvelope = (total, { limit, offset }, count) => {
  const end = offset + count;
  const hasMore = end < total;
  return {
    total, limit, offset, page: Math.floor(offset / limit) + 1,
    totalPages: Math.max(1, Math.ceil(total / limit)), hasMore, nextOffset: hasMore ? end : null
  };
};
