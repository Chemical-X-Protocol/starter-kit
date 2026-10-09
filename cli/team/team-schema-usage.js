/**
 * Chemical X Protocol: measured usage per agent per run (#2497).
 * Separate from agent_tasks on purpose: one task can span agents and runs, and a measured row keeps
 * its provenance (run, model, pricing source) instead of overwriting a task total.
 * task_source says how task_id was found: 'claims-window' (the handle's claim in the db overlapped the
 * run) or 'transcript-claim' (the agent's own `task claim <id>` command). NULL task_id means unknown.
 */

export const initUsageSchema = (db) => {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_usage (
      run_id TEXT NOT NULL, agent_id TEXT NOT NULL, handle TEXT, task_id INTEGER, task_source TEXT,
      label TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'unknown',
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0.0, pricing_source TEXT NOT NULL DEFAULT '',
      started_at INTEGER, ended_at INTEGER, imported_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_usage_task ON task_usage(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_usage_handle ON task_usage(handle);
  `);
};
