/**
 * Chemical X Protocol: Vector Delivery System (VDS) Schema
 * Aligns agent tasks with Hall of the Gods VDS specification
 */

const migrateCols = (db, tbl, cols) => {
  const existing = new Set((db.prepare(`PRAGMA table_info(${tbl})`).all() || []).map((c) => c.name));
  for (const [col, def] of cols) {
    if (!existing.has(col)) {
      try {
        db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def};`);
      } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
      }
    }
  }
};

export const migrateVdsColumns = (db) => {
  if (!db) return;
  migrateCols(db, 'agent_tasks', [
    ['moscow', "TEXT NOT NULL DEFAULT 'must'"],
    ['vds_priority', "TEXT NOT NULL DEFAULT 'medium'"],
    ['vds_phase', "TEXT NOT NULL DEFAULT 'planning'"],
    ['vds_status', "TEXT NOT NULL DEFAULT 'ready'"],
    ['task_url', "TEXT NOT NULL DEFAULT ''"],
    ['sprint_tag', "TEXT NOT NULL DEFAULT ''"]
  ]);
};

export const initVdsSchema = (db) => {
  if (!db) return;
  migrateVdsColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_vds_slot ON agent_tasks(moscow, vds_priority);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_vds_phase ON agent_tasks(vds_phase, vds_status);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_sprint ON agent_tasks(sprint_tag);
  `);
};
