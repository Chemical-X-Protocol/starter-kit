/**
 * The standup light store: one light per task per standup, kept in `standup_lights`.
 * A light is green, yellow, red or blocked. Recording a second light for the same task in the
 * same standup replaces the first. The clock rules that decide when a standup advances live elsewhere
 * (docs/team-vds.md); this module only stores and reads the lights.
 */
export const LIGHTS = Object.freeze(['green', 'yellow', 'red', 'blocked']);

/** Additive: creates the table the first time a board opens it, and does nothing after that. */
export const initStandupSchema = (db) => {
  if (!db) return;
  db.exec(`CREATE TABLE IF NOT EXISTS standup_lights (
    task_id INTEGER NOT NULL,
    standup INTEGER NOT NULL,
    light TEXT NOT NULL,
    set_by TEXT,
    at INTEGER,
    PRIMARY KEY (task_id, standup)
  )`);
};

const UPSERT_SQL = `INSERT INTO standup_lights (task_id, standup, light, set_by, at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (task_id, standup) DO UPDATE SET light = excluded.light, set_by = excluded.set_by, at = excluded.at`;

/** Records a light for a task in one standup, replacing any light already there. Returns the row or { error }. */
export const recordLight = (db, { taskId, standup, light, setBy = null, now = Date.now() } = {}) => {
  const isKnownLight = LIGHTS.includes(light);
  if (!isKnownLight) return { error: `Unknown light "${light}". Use one of: ${LIGHTS.join(', ')}.` };
  db.prepare(UPSERT_SQL).run(taskId, standup, light, setBy, now);
  return { task_id: taskId, standup, light, set_by: setBy, at: now };
};

/** Every light recorded for one task, oldest standup first. */
export const lightsFor = (db, taskId) =>
  db.prepare('SELECT task_id, standup, light, set_by, at FROM standup_lights WHERE task_id = ? ORDER BY standup').all(taskId)
    .map((row) => ({ ...row }));

/** The number the next standup takes: one past the highest recorded, or 1 when none is recorded. */
export const nextStandup = (db) => {
  const { highest } = db.prepare('SELECT MAX(standup) AS highest FROM standup_lights').get();
  return (highest ?? 0) + 1;
};
