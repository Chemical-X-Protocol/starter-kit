/**
 * The one-status migration, step 1 (#7667): back up the coordination db, then plan the move from the two
 * old status fields to vds_status. Planning changes no rows. Applying the value mapping in docs/team-vds.md is #7668.
 */
import fs from 'node:fs';
import path from 'node:path';

/** A dated file name, safe on every filesystem: no colons or dots before the extension. */
export const backupName = (now = new Date()) => `index-${now.toISOString().replace(/[:.]/g, '-')}.db`;

/**
 * Copies the open database with VACUUM INTO, which is consistent while the db is in use.
 * Never overwrites: a file that already exists is an error, so a backup cannot be lost to a second run.
 */
export const backupIndexDb = (db, backupDir, now = new Date()) => {
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, backupName(now));
  const isTaken = fs.existsSync(target);
  if (isTaken) throw new Error(`backup already exists: ${target}`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
};

/** Work the migration must not race: tasks in progress or in review. */
export const liveWork = (db) => db.prepare("SELECT id, title, status FROM agent_tasks WHERE status IN ('in_progress', 'review') ORDER BY id").all();

/** Each (status, vds_status) pair with its count: the input the mapping in docs/team-vds.md turns into one value. */
export const statusPairs = (db) => db.prepare('SELECT status, vds_status, COUNT(*) AS n FROM agent_tasks GROUP BY status, vds_status ORDER BY status, vds_status').all();

/**
 * Plan the migration: take the backup, list live work, and count the status pairs.
 * `refused` is true when live work exists and force is not set. Planning never changes a task row.
 */
export const planVdsMigration = (db, { backupDir, now = new Date(), force = false } = {}) => {
  const backup = backupIndexDb(db, backupDir, now);
  const live = liveWork(db);
  const hasLiveWork = live.length > 0;
  const refused = hasLiveWork && !force;
  return { backup, live, pairs: statusPairs(db), refused };
};
