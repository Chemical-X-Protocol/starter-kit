/**
 * Chemical X Protocol: Agent Memory & Attribution Schema
 * Tracks memory injection, retrieval precision per dollar, and stale retries
 */

export const initMemorySchema = (db) => {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      agent_id TEXT NOT NULL,
      injected_context_type TEXT NOT NULL,
      provenance_path TEXT NOT NULL,
      tokens_injected INTEGER NOT NULL DEFAULT 0,
      was_utilized INTEGER NOT NULL DEFAULT 0,
      caused_retry INTEGER NOT NULL DEFAULT 0,
      injected_at INTEGER NOT NULL,
      ttl_expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mem_log_task ON agent_memory_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_mem_log_agent ON agent_memory_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_mem_log_ttl ON agent_memory_log(ttl_expires_at);
  `);
};
