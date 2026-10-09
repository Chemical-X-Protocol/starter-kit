/**
 * Chemical X Protocol: repo attribution and merge bookkeeping for the coordination db (#2488).
 *   agent_tasks.repo      owning package, relative to the db's root ('.' = the root itself).
 *   task_aliases          (source_repo, old_id) -> new_id for task ids a merge renumbered.
 *   team_merge_ledger     (source_db, source_table, source_id) -> new_id for every merged row,
 *                         so a re-run sweeps in only rows written after the previous merge.
 *   team_merge_runs       one row per real merge run (backup paths, counts). A package db listed
 *                         here is merged: coordination-db.js stops serving it as a silo.
 */

const hasColumn = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);

const addRepoColumn = (db) => {
  const hasRepo = hasColumn(db, 'agent_tasks', 'repo');
  if (hasRepo) return;
  try {
    db.exec("ALTER TABLE agent_tasks ADD COLUMN repo TEXT NOT NULL DEFAULT '.';");
  } catch (err) {
    const isDuplicate = Boolean(err.message?.includes('duplicate column'));
    if (!isDuplicate) throw err;
  }
};

export const initRepoSchema = (db) => {
  if (!db) return;
  addRepoColumn(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_repo ON agent_tasks(repo, status);
    CREATE TABLE IF NOT EXISTS task_aliases (
      source_repo TEXT NOT NULL, old_id INTEGER NOT NULL, new_id INTEGER NOT NULL,
      source_db TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      PRIMARY KEY (source_repo, old_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_aliases_old ON task_aliases(old_id);
    CREATE INDEX IF NOT EXISTS idx_task_aliases_new ON task_aliases(new_id);
    CREATE TABLE IF NOT EXISTS team_merge_ledger (
      source_db TEXT NOT NULL, source_table TEXT NOT NULL, source_id TEXT NOT NULL,
      new_id TEXT NOT NULL, merged_at INTEGER NOT NULL,
      PRIMARY KEY (source_db, source_table, source_id)
    );
    CREATE TABLE IF NOT EXISTS team_merge_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_db TEXT NOT NULL, source_repo TEXT NOT NULL,
      keep_ids TEXT NOT NULL, backups TEXT NOT NULL DEFAULT '[]', counts TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_team_merge_runs_source ON team_merge_runs(source_db);
  `);
};
