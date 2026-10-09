/**
 * Chemical X Protocol: store priced run usage in task_usage and map each agent to a task (#2497).
 * Mapping, in order: (1) the handle's claim in agent_tasks whose life overlaps the agent's run window
 * ('claims-window'; the most recently updated overlapping task wins); (2) a `task claim <id>` command in the
 * agent's own transcript when that task exists ('transcript-claim'). Otherwise task_id stays NULL.
 * Re-importing a run replaces its rows, so an import is idempotent.
 */
import { initUsageSchema } from './team-schema-usage.js';

const WINDOW_SQL = `SELECT id FROM agent_tasks WHERE assigned_agent_id = ? AND created_at <= ? AND updated_at >= ?
  ORDER BY updated_at DESC LIMIT 1`;

const taskExists = (db, id) => Boolean(db.prepare('SELECT 1 AS ok FROM agent_tasks WHERE id = ?').get(id));

export const mapAgentToTask = (db, row) => {
  const hasWindow = Boolean(row.handle) && Number.isFinite(row.startedAt) && Number.isFinite(row.endedAt);
  const byWindow = hasWindow ? db.prepare(WINDOW_SQL).get(row.handle, row.endedAt, row.startedAt) : null;
  if (byWindow) return { taskId: byWindow.id, source: 'claims-window' };
  const claimed = (row.claims || []).find((id) => taskExists(db, id));
  if (claimed) return { taskId: claimed, source: 'transcript-claim' };
  return { taskId: null, source: null };
};

const INSERT_SQL = `INSERT OR REPLACE INTO task_usage (
  run_id, agent_id, handle, task_id, task_source, label, phase, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, total_tokens, calls, cost_usd,
  pricing_source, started_at, ended_at, imported_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Replace the stored rows of a priced run. Returns { imported, mapped }. */
export const importPricedRun = (db, priced, now = Date.now()) => {
  initUsageSchema(db);
  const insert = db.prepare(INSERT_SQL);
  let mapped = 0;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM task_usage WHERE run_id = ?').run(priced.runId);
    for (const r of priced.rows) {
      const { taskId, source } = mapAgentToTask(db, r);
      mapped += taskId ? 1 : 0;
      insert.run(priced.runId, r.agentId, r.handle, taskId, source, r.label, r.phase, r.model, r.input, r.output,
        r.cacheRead, r.write5m, r.write1h, r.total, r.calls, r.cost, priced.pricingSource, r.startedAt, r.endedAt, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { imported: priced.rows.length, mapped };
};

/** Stored usage rolled up per task, for task cards. */
export const taskUsageTotals = (db, taskId) => db.prepare(
  `SELECT COUNT(*) AS agents, SUM(total_tokens) AS total_tokens, SUM(cost_usd) AS cost_usd
   FROM task_usage WHERE task_id = ?`
).get(taskId);
