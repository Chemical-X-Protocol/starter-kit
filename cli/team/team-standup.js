/**
 * The standup light store: one light per task per standup, kept in `standup_lights`.
 * A light is green, yellow, red or blocked. Recording a second light for the same task in the
 * same standup replaces the first. The clock rules live in team-clock.js (docs/team-vds.md);
 * runStandup applies them once to every open task and records the result (`chemx team standup`).
 */
import { nextLight } from './team-clock.js';

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

const OPEN_TASKS_SQL = "SELECT id, title FROM agent_tasks WHERE status IN ('queued', 'in_progress', 'review') ORDER BY id";
const UPDATE_SINCE_SQL = 'SELECT 1 FROM agent_feed WHERE task_id = ? AND timestamp > ? LIMIT 1';

/** When the standup before this one was recorded, or 0 when there was none (every feed event then counts). */
const previousStandupAt = (db, standup) => {
  const { at } = db.prepare('SELECT MAX(at) AS at FROM standup_lights WHERE standup = ?').get(standup - 1);
  return at ?? 0;
};

/** A task's latest recorded light; a task never seen at a standup starts green. */
const currentLight = (db, taskId) => lightsFor(db, taskId).at(-1)?.light ?? 'green';

/** True when the feed holds any event for the task (a comment, a status change, ...) after `since`. */
const hadUpdateSince = (db, taskId, since) => Boolean(db.prepare(UPDATE_SINCE_SQL).get(taskId, since));

/** Moves one task to its next light and records it. Manual flags are not stored yet, so isManual is false. */
const advanceTask = (db, task, { standup, since, setBy, now }) => {
  const oldLight = currentLight(db, task.id);
  const isBlocked = oldLight === 'blocked';
  const hadUpdate = hadUpdateSince(db, task.id, since);
  const newLight = nextLight({ current: oldLight, hadUpdate, isManual: false, isBlocked });
  recordLight(db, { taskId: task.id, standup, light: newLight, setBy, now });
  return { id: task.id, title: task.title, oldLight, newLight };
};

/** Runs one standup over every open task (queued, in_progress, review). Returns { standup, tasks }. */
export const runStandup = (db, { setBy = null, now = Date.now() } = {}) => {
  const standup = nextStandup(db);
  const context = { standup, since: previousStandupAt(db, standup), setBy, now };
  const tasks = db.prepare(OPEN_TASKS_SQL).all().map((task) => advanceTask(db, task, context));
  return { standup, tasks };
};

const formatStandupRow = (row) => `  #${row.id}  ${row.title}  ${row.oldLight} -> ${row.newLight}\n`;

/** `chemx team standup [--json]`: one line per open task with its old and new light. */
export const handleStandupCommand = (db, flags = {}, isCli = false) => {
  const result = runStandup(db, { setBy: flags.as || null });
  if (!isCli) return result;
  const isJson = flags.isJson === true;
  if (isJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  process.stdout.write(`Standup ${result.standup}: ${result.tasks.length} open task(s)\n`);
  for (const row of result.tasks) process.stdout.write(formatStandupRow(row));
  return result;
};
