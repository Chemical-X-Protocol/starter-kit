/**
 * Chemical X Protocol: Project & Persistent Coordinator Schema
 * Tracks persistent project sessions, messages, and learned invariants
 */

export const initProjectsSchema = (db) => {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      goal_description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      mode TEXT NOT NULL DEFAULT 'turn_driven',
      budget_limit_usd REAL NOT NULL DEFAULT 2.0,
      budget_spent_usd REAL NOT NULL DEFAULT 0.0,
      max_turns INTEGER NOT NULL DEFAULT 10,
      current_turn INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS project_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      turn_index INTEGER NOT NULL DEFAULT 0,
      author_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      message TEXT NOT NULL,
      state_snapshot TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      tier TEXT NOT NULL DEFAULT 'general',
      pattern TEXT NOT NULL,
      rule_text TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      verified_count INTEGER NOT NULL DEFAULT 1,
      provenance_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_sessions_status ON project_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_project_messages_proj ON project_messages(project_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_project_learnings_tier ON project_learnings(tier);
    CREATE INDEX IF NOT EXISTS idx_project_learnings_pattern ON project_learnings(pattern);
  `);
};
