/**
 * Paged task reads for the board and the API (#7604). Rows are "cards": the columns a board needs,
 * no description or JSON blobs (fetch /api/tasks/:id for those); full=1 returns whole rows.
 */
import { parseTaskRow } from './team/team-db-task-helpers.js';
import { formatTaskTokenStamp } from './team/team-telemetry.js';
import { BOARD_COLUMNS, isTruthyFlag, readPageParams, pageEnvelope } from './ui-paging.js';
import { buildUiTaskWhere, resolveTaskOrder } from './ui-paging-task-where.js';

const healthSql = (column, pathA, pathB) =>
  `CASE WHEN json_valid(${column}) THEN COALESCE(json_extract(${column}, '${pathA}'), json_extract(${column}, '${pathB}')) END`;

// Card columns are computed for the page's rows only: SQLite evaluates a select list before it sorts,
// so a JSON extract or a subtask subquery in the outer page query ran for all 7k rows (13s).
const TASK_CARD_COLUMNS = `t.id, t.title, t.status, t.tier, t.priority, t.parent_id, t.target_path, t.assigned_agent_id, t.repo,
  t.kind, t.needs, t.task_url, t.moscow, t.vds_priority, t.created_at, t.updated_at, t.prompt_tokens, t.completion_tokens,
  t.total_tokens, t.cost_usd,
  ${healthSql('t.result_payload', '$.healthAfter', '$.receipt.healthAfter')} AS health_after,
  CASE WHEN json_valid(t.diff_receipt) THEN json_extract(t.diff_receipt, '$.verified') END AS receipt_verified`;

const countSubtasks = (db, ids) => {
  const hasIds = ids.length > 0;
  if (!hasIds) return new Map();
  const rows = db.prepare(`SELECT parent_id, COUNT(*) AS c FROM agent_tasks WHERE parent_id IN (${ids.map(() => '?').join(', ')})
    GROUP BY parent_id`).all(...ids);
  return new Map(rows.map((r) => [r.parent_id, r.c]));
};

const toTaskCard = (row, subtasks) => ({
  ...row,
  moscow: row.moscow || 'must',
  vds_priority: row.vds_priority || 'medium',
  parentId: row.parent_id,
  assignedAgentId: row.assigned_agent_id,
  subtaskCount: Number(subtasks.get(row.id) || 0),
  isVerified: row.health_after !== null || Boolean(row.receipt_verified),
  tokenStamp: formatTaskTokenStamp(row)
});

/** One page of task cards (or full rows with full=1) plus the envelope. */
export const listTasksPage = (db, params = {}) => {
  const paging = readPageParams(params);
  if (!db) return { success: true, tasks: [], ...pageEnvelope(0, paging, 0) };
  const { where, values, statusList } = buildUiTaskWhere(params);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM agent_tasks${where}`).get(...values)?.c || 0;
  const order = resolveTaskOrder(params.sort, statusList);
  const pageIds = `SELECT id FROM agent_tasks${where}${order} LIMIT ? OFFSET ?`;
  const isFull = isTruthyFlag(params.full);
  const columns = isFull ? 't.*' : TASK_CARD_COLUMNS;
  const outerOrder = order.replace(/(\w+) (ASC|DESC)/g, 't.$1 $2');
  const rows = db.prepare(`SELECT ${columns} FROM (${pageIds}) AS p JOIN agent_tasks AS t ON t.id = p.id${outerOrder}`)
    .all(...values, paging.limit, paging.offset);
  const subtasks = countSubtasks(db, rows.map((r) => r.id));
  const tasks = isFull ? rows.map(parseTaskRow) : rows.map((row) => toTaskCard(row, subtasks));
  return { success: true, tasks, ...pageEnvelope(total, paging, tasks.length) };
};

/** The first page of every board column in one round trip; filters apply to each column. */
export const listTaskBoard = (db, params = {}) => {
  const requested = String(params.columns || '').split(',').map((s) => s.trim()).filter(Boolean);
  const columns = requested.length > 0 ? requested : BOARD_COLUMNS;
  const board = {};
  for (const status of columns) board[status] = listTasksPage(db, { ...params, status, offset: 0, page: undefined });
  return { success: true, columns: board };
};

/** The most recently touched tasks, as enriched cards: the live view's bounded task list. */
export const listRecentTasks = (db, limit = 50) => listTasksPage(db, { limit, sort: 'recent' }).tasks;
