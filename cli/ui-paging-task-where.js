/**
 * The WHERE and ORDER BY of a paged task read (#7604): the CLI's own filters (buildTaskWhere) plus the
 * board's: status lists with aliases, tier, hideTests and q (title, path, assignee or #id).
 */
import { buildTaskWhere } from './team/team-db-task-helpers.js';
import { isTruthyFlag } from './ui-paging.js';

const STATUS_ALIASES = { done: ['done', 'completed'], blocked: ['blocked', 'failed'] };
const RECENT_FIRST_STATUSES = new Set(['done', 'completed', 'cancelled', 'duplicate']);
const TEST_TITLE_PREFIXES = ['E2E Verify Task', 'API Test Task'];

const escapeLike = (text) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
const placeholders = (list) => list.map(() => '?').join(', ');

const addTierFilter = (tier, conditions, values) => {
  // An untiered task shows as utility on the board, so the utility filter includes it.
  const isUtilityTier = tier === 'utility';
  const isNamedTier = Boolean(tier) && !isUtilityTier;
  if (isUtilityTier) conditions.push("(tier = 'utility' OR tier IS NULL OR tier = '')");
  if (isNamedTier) {
    conditions.push('tier = ?');
    values.push(tier);
  }
};

const addTextFilter = (q, conditions, values) => {
  const hasQuery = q.length > 0;
  if (!hasQuery) return;
  const idMatch = q.match(/^#?(\d+)$/);
  const pattern = escapeLike(q);
  const textSql = "(title LIKE ? ESCAPE '\\' OR target_path LIKE ? ESCAPE '\\' OR assigned_agent_id LIKE ? ESCAPE '\\'";
  conditions.push(idMatch ? `${textSql} OR id = ?)` : `${textSql})`);
  values.push(pattern, pattern, pattern, ...(idMatch ? [Number(idMatch[1])] : []));
};

export const buildUiTaskWhere = (params = {}) => {
  const statusList = String(params.status || '').split(',').map((s) => s.trim()).filter(Boolean)
    .flatMap((s) => STATUS_ALIASES[s] || [s]);
  const { conditions, params: values } = buildTaskWhere({ ...params, status: undefined });
  const hasStatusList = statusList.length > 0;
  if (hasStatusList) {
    conditions.push(`status IN (${placeholders(statusList)})`);
    values.push(...statusList);
  }
  addTierFilter(params.tier && params.tier !== 'all' ? String(params.tier) : '', conditions, values);
  const hidesTests = isTruthyFlag(params.hideTests);
  if (hidesTests) {
    for (const prefix of TEST_TITLE_PREFIXES) {
      conditions.push('title NOT LIKE ?');
      values.push(`${prefix}%`);
    }
  }
  addTextFilter(String(params.q || '').trim(), conditions, values);
  return { where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '', values, statusList };
};

// Done-like columns read most recently updated first; the rest by priority, then id.
export const resolveTaskOrder = (sort, statusList) => {
  const isRecentDefault = statusList.length > 0 && statusList.every((s) => RECENT_FIRST_STATUSES.has(s));
  const mode = sort || (isRecentDefault ? 'recent' : 'priority');
  const orders = { recent: ' ORDER BY updated_at DESC, id DESC', newest: ' ORDER BY id DESC' };
  return orders[mode] || ' ORDER BY priority ASC, id ASC';
};
