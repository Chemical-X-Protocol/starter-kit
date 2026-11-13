/**
 * Schema of the async check queue (`chemx team check`): additive only, so an older chemx binary that
 * never reads these tables stays safe. Columns beyond phase 1 (release, gate, epoch) are created now
 * so the later phases need no migration.
 */

// tree_fp is the shallow fingerprint the enqueue path computes; tree_fp_deep (submodule working trees too) is set by the worker
// and checked only when a cache or join candidate needs verifying. A db created by the first phase 1 build lacks the column.
const ensureDeepFingerprintColumn = (db) => {
  const columns = db.prepare('PRAGMA table_info(check_jobs)').all();
  const hasColumn = columns.some((column) => column.name === 'tree_fp_deep');
  if (hasColumn) return;
  try {
    db.exec("ALTER TABLE check_jobs ADD COLUMN tree_fp_deep TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    // A second process added it between the check and the ALTER.
    const isRace = /duplicate column/i.test(String(error?.message));
    if (!isRace) throw error;
  }
};

export const initChecksSchema = (db) => {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS check_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, cwd TEXT NOT NULL, command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]', tree_fp TEXT NOT NULL DEFAULT '', tree_fp_deep TEXT NOT NULL DEFAULT '', release TEXT NOT NULL DEFAULT '',
      gate TEXT NOT NULL DEFAULT 'none', run_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 2, requested_by TEXT NOT NULL, coalesced_into INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 0, worker_token TEXT,
      worker_pid INTEGER NOT NULL DEFAULT 0, child_pid INTEGER NOT NULL DEFAULT 0, reason_held TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, result TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_check_jobs_due ON check_jobs(status, run_at, priority, id);
    CREATE INDEX IF NOT EXISTS idx_check_jobs_key ON check_jobs(kind, cwd, command, status);
    CREATE TABLE IF NOT EXISTS check_requesters (
      job_id INTEGER NOT NULL, agent_id TEXT NOT NULL, task_id INTEGER, notified_at INTEGER,
      PRIMARY KEY (job_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS check_drainer (
      id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL,
      heartbeat INTEGER NOT NULL, started_at INTEGER NOT NULL
    );
  `);
  ensureDeepFingerprintColumn(db);
};
