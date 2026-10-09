/**
 * Chemical X Protocol: Multi-Agent Swarm Schema
 * Co-located with codebase AST index in .chemx/index.db
 */

import { initMemorySchema } from './team-schema-memory.js';
import { initProjectsSchema } from './team-schema-projects.js';
import { initVdsSchema } from './team-schema-vds.js';
import { initUsageSchema } from './team-schema-usage.js';

const migrateCols = (db, tbl, cols) => {
  const existing = new Set((db.prepare(`PRAGMA table_info(${tbl})`).all() || []).map((c) => c.name));
  for (const [col, def] of cols) {
    const isMissingColumn = Boolean(!existing.has(col));
    if (isMissingColumn) {
      try {
        db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def};`);
      } catch (err) {
        const isDuplicateColumn = Boolean(err.message?.includes('duplicate column'));
        if (!isDuplicateColumn) throw err;
      }
    }
  }
};

// telemetry_source: 'tokens' | 'log' | 'legacy'; NULL means unknown (never measured), not zero.
const migrateTelemetrySource = (db) => {
  const existing = new Set(db.prepare('PRAGMA table_info(agent_tasks)').all().map((c) => c.name));
  const hasTelemetrySource = Boolean(existing.has('telemetry_source'));
  if (hasTelemetrySource) return;
  migrateCols(db, 'agent_tasks', [['telemetry_source', 'TEXT']]);
  db.exec("UPDATE agent_tasks SET telemetry_source = 'legacy' WHERE total_tokens > 0 OR cost_usd > 0;");
};

export const migrateTelemetryColumns = (db) => {
  if (!db) return;
  migrateTelemetrySource(db);
  migrateCols(db, 'agent_tasks', [
    ['prompt_tokens', 'INTEGER NOT NULL DEFAULT 0'], ['completion_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cached_tokens', 'INTEGER NOT NULL DEFAULT 0'], ['total_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cost_usd', 'REAL NOT NULL DEFAULT 0.0'], ['origin_type', "TEXT NOT NULL DEFAULT 'manual'"],
    ['rule_id', "TEXT NOT NULL DEFAULT ''"], ['violation_snapshot', "TEXT NOT NULL DEFAULT '{}'"], ['diff_receipt', "TEXT NOT NULL DEFAULT '{}'"]
  ]);
  migrateCols(db, 'agents', [
    ['total_prompt_tokens', 'INTEGER NOT NULL DEFAULT 0'], ['total_completion_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['total_tokens', 'INTEGER NOT NULL DEFAULT 0'], ['total_cost_usd', 'REAL NOT NULL DEFAULT 0.0']
  ]);
};

export const migrateFeedColumns = (db) => {
  if (!db) return;
  migrateCols(db, 'agent_feed', [['recipient_id', 'TEXT'], ['read_at', 'INTEGER']]);
};

export const migrateLeaseColumns = (db) => {
  if (!db) return;
  migrateCols(db, 'file_leases', [['pid', 'INTEGER NOT NULL DEFAULT 0']]);
  migrateCols(db, 'file_lock_queue', [['pid', 'INTEGER NOT NULL DEFAULT 0'], ['last_seen_at', 'INTEGER NOT NULL DEFAULT 0']]);
};

export const initTeamSchema = (db) => {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',
      current_task_id INTEGER, capabilities TEXT NOT NULL DEFAULT '[]', heartbeat INTEGER NOT NULL,
      total_prompt_tokens INTEGER NOT NULL DEFAULT 0, total_completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL NOT NULL DEFAULT 0.0, metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT '', target_path TEXT, target_symbol TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 2, assigned_agent_id TEXT,
      blocked_reason TEXT NOT NULL DEFAULT '', parent_id INTEGER, dependencies TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0.0, result_payload TEXT NOT NULL DEFAULT '{}', origin_type TEXT NOT NULL DEFAULT 'manual',
      rule_id TEXT NOT NULL DEFAULT '', violation_snapshot TEXT NOT NULL DEFAULT '{}', diff_receipt TEXT NOT NULL DEFAULT '{}',
      telemetry_source TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, author_id TEXT NOT NULL,
      recipient_id TEXT, read_at INTEGER, thread_id INTEGER, task_id INTEGER, file_path TEXT,
      event_type TEXT NOT NULL DEFAULT 'broadcast', message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS file_leases (
      file_path TEXT PRIMARY KEY, locked_by TEXT NOT NULL, acquired_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT '', pid INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS file_lock_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, agent_id TEXT NOT NULL,
      requested_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', priority INTEGER NOT NULL DEFAULT 2, purpose TEXT NOT NULL DEFAULT '',
      pid INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS forum_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT NOT NULL, title TEXT NOT NULL,
      feature_tag TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_forum_topics_cat ON forum_topics(category_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(assigned_agent_id); CREATE INDEX IF NOT EXISTS idx_agent_tasks_path ON agent_tasks(target_path);
    CREATE INDEX IF NOT EXISTS idx_agent_feed_time ON agent_feed(timestamp); CREATE INDEX IF NOT EXISTS idx_agent_feed_thread ON agent_feed(thread_id);
    CREATE INDEX IF NOT EXISTS idx_agent_feed_recipient ON agent_feed(recipient_id); CREATE INDEX IF NOT EXISTS idx_agent_feed_inbox ON agent_feed(recipient_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_feed_unread ON agent_feed(recipient_id, read_at) WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_file_leases_locked ON file_leases(locked_by); CREATE INDEX IF NOT EXISTS idx_file_leases_expiry ON file_leases(expires_at);
    CREATE INDEX IF NOT EXISTS idx_file_lock_queue_file ON file_lock_queue(file_path, status);
  `);
  migrateFeedColumns(db);
  migrateTelemetryColumns(db);
  migrateLeaseColumns(db);
  initMemorySchema(db);
  initProjectsSchema(db);
  initVdsSchema(db);
  initUsageSchema(db);
};
