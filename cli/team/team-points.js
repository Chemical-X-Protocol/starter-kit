/**
 * Fibonacci points on a task, the estimate of its time and tokens, and the reports that relate them to actuals.
 * `chemx team task points <id> <n>` sets the estimate in points. `chemx team task estimate <id> <minutes> <tokens>`
 * sets the planned time and tokens. `chemx team tokens --curve` and `--velocity` read them back.
 * Measured figures come from the same sources as `chemx team tokens --epic`: the task's own telemetry first,
 * then imported run usage. A done task with no measured figures is counted as unmeasured, never as zero.
 */
import { figuresOf, usageByTask } from './team-tokens-epic.js';

export const FIBONACCI = Object.freeze([1, 2, 3, 5, 8, 13, 21]);
const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const SIZE_CLASS = Object.freeze({ 1: 'sand', 2: 'pebbles', 3: 'pebbles', 5: 'rocks', 8: 'boulders', 13: 'boulders' });
const ESTIMATE_COLUMNS = Object.freeze([['points', 'INTEGER'], ['est_minutes', 'INTEGER'], ['est_tokens', 'INTEGER']]);

export const sizeClassOf = (points) => (points >= 21 ? 'epic' : SIZE_CLASS[points] || 'unknown');

const hasColumn = (db, column) => db.prepare('PRAGMA table_info(agent_tasks)').all().some((col) => col.name === column);

/** Additive: an older board gains the estimate columns the first time it opens. */
export const initPointsSchema = (db) => {
  if (!db) return;
  for (const [column, type] of ESTIMATE_COLUMNS) {
    const isMissing = !hasColumn(db, column);
    if (!isMissing) continue;
    try {
      db.exec(`ALTER TABLE agent_tasks ADD COLUMN ${column} ${type}`);
    } catch (err) {
      const isDuplicate = String(err.message).includes('duplicate column');
      if (!isDuplicate) throw err;
    }
  }
};

const findTask = (db, taskId) => db.prepare('SELECT id FROM agent_tasks WHERE id = ?').get(Number(taskId));

/** Sets a task's points. Refuses any value outside the Fibonacci set. */
export const setPoints = (db, taskId, value) => {
  const id = Number(taskId);
  const points = Number(value);
  const isValid = FIBONACCI.includes(points);
  if (!isValid) return { error: `Points must be one of ${FIBONACCI.join(', ')}; got "${value}".` };
  const isFound = Boolean(findTask(db, id));
  if (!isFound) return { error: `Task #${taskId} not found.` };
  db.prepare('UPDATE agent_tasks SET points = ? WHERE id = ?').run(points, id);
  return { id, points, size: sizeClassOf(points) };
};

const BREAKDOWN_POINTS = 8;

const hasChildTasks = (db, taskId) => Boolean(db.prepare('SELECT id FROM agent_tasks WHERE parent_id = ? LIMIT 1').get(Number(taskId)));

/**
 * A task of 8 points or more must be broken down (have child tasks) before it is claimed or moved to in_progress.
 * A task that does not exist, or has no points, is not gated here: the claim or update reports that itself.
 * @returns {{ ok: true } | { error: string }}
 */
export const breakdownGate = (db, taskId) => {
  const row = db.prepare('SELECT points FROM agent_tasks WHERE id = ?').get(Number(taskId));
  const isLarge = Number(row?.points) >= BREAKDOWN_POINTS;
  const isBrokenDown = hasChildTasks(db, taskId);
  const isBlocked = isLarge && !isBrokenDown;
  if (!isBlocked) return { ok: true };
  return { error: `Task #${taskId} is ${row.points} points (${BREAKDOWN_POINTS} or more) and has no child tasks. Break it down first: add the child tasks with --parent=${taskId}, then claim or start it.` };
};

/** Records the planned time (minutes) and tokens for a task, before it is built. Both must be positive whole numbers. */
export const setEstimate = (db, taskId, minutes, tokens) => {
  const id = Number(taskId);
  const mins = Number(minutes);
  const toks = Number(tokens);
  const isWhole = Number.isInteger(mins) && Number.isInteger(toks) && mins > 0 && toks > 0;
  if (!isWhole) return { error: 'Usage: chemx team task estimate <id> <minutes> <tokens> (positive whole numbers).' };
  const isFound = Boolean(findTask(db, id));
  if (!isFound) return { error: `Task #${taskId} not found.` };
  db.prepare('UPDATE agent_tasks SET est_minutes = ?, est_tokens = ? WHERE id = ?').run(mins, toks, id);
  return { id, estMinutes: mins, estTokens: toks };
};

const median = (xs) => {
  const isEmpty = xs.length === 0;
  if (isEmpty) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length);

const doneEstimated = (db) => db.prepare("SELECT * FROM agent_tasks WHERE status = 'done' AND points IS NOT NULL ORDER BY id").all();

/** Actual minutes from claim to done, when the task was claimed. Null when there is no claim time. */
export const actualMinutesOf = (task) => {
  const hasClaim = task.claimed_at !== null && task.claimed_at !== undefined;
  if (!hasClaim) return null;
  return (task.updated_at - task.claimed_at) / MINUTE_MS;
};

/**
 * One row per point value: tasks done, measured figures, and the median tokens, mean cost, and wall time.
 * Also planned vs actual: the mean estimate in minutes and tokens, and the median actual minutes, over the tasks that have them.
 */
export const curveRows = (db) => {
  const tasks = doneEstimated(db);
  const usage = usageByTask(db, tasks.map((task) => task.id));
  const buckets = new Map();
  for (const task of tasks) {
    const bucket = buckets.get(task.points) || { points: task.points, size: sizeClassOf(task.points), tasks: 0, measured: 0, tokens: [], costs: [], walls: [], estMinutes: [], estTokens: [], actualMinutes: [] };
    bucket.tasks += 1;
    const figures = figuresOf(task, usage.get(task.id));
    if (figures.source) {
      bucket.measured += 1;
      bucket.tokens.push(figures.totalTokens);
      bucket.costs.push(figures.costUsd);
      bucket.walls.push(task.updated_at - task.created_at);
    }
    const hasEstimate = task.est_minutes !== null && task.est_minutes !== undefined;
    if (hasEstimate) bucket.estMinutes.push(task.est_minutes);
    const hasEstTokens = task.est_tokens !== null && task.est_tokens !== undefined;
    if (hasEstTokens) bucket.estTokens.push(task.est_tokens);
    const actual = actualMinutesOf(task);
    const hasActual = actual !== null;
    if (hasActual) bucket.actualMinutes.push(actual);
    buckets.set(task.points, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.points - b.points).map((b) => ({
    points: b.points, size: b.size, tasks: b.tasks, measured: b.measured,
    medianTokens: median(b.tokens), meanCostUsd: mean(b.costs), medianWallMs: median(b.walls),
    estMinutes: mean(b.estMinutes), estTokens: mean(b.estTokens), actualMinutes: median(b.actualMinutes)
  }));
};

/** Points finished in the window: done tasks whose last update is inside the last `days`. */
export const velocity = (db, { days = 14, now = Date.now() } = {}) => {
  const since = now - days * DAY_MS;
  const rows = db.prepare("SELECT points FROM agent_tasks WHERE status = 'done' AND points IS NOT NULL AND updated_at >= ?").all(since);
  const points = rows.reduce((sum, row) => sum + row.points, 0);
  return { days, tasks: rows.length, points, pointsPerWeek: Number(((points / days) * 7).toFixed(1)) };
};

const pad = (text, width) => String(text).padEnd(width);
const padLeft = (text, width) => String(text).padStart(width);
const orDash = (value, format) => (value === null ? '-' : format(value));

export const renderCurve = (rows) => {
  const hasRows = rows.length > 0;
  if (!hasRows) return 'No done tasks with points yet. Set points with: chemx team task points <id> <n>\n';
  const head = '  points  size       done  measured  med tokens  mean cost  med wall  est min  act min  est tokens';
  const lines = rows.map((r) => [
    `  ${pad(r.points, 7)} ${pad(r.size, 10)} ${padLeft(r.tasks, 4)}  ${padLeft(r.measured, 8)}`,
    `  ${padLeft(orDash(r.medianTokens, (v) => String(Math.round(v))), 10)}`,
    `  ${padLeft(orDash(r.meanCostUsd, (v) => `$${v.toFixed(4)}`), 9)}`,
    `  ${padLeft(orDash(r.medianWallMs, (v) => `${Math.round(v / MINUTE_MS)}m`), 8)}`,
    `  ${padLeft(orDash(r.estMinutes, (v) => String(Math.round(v))), 7)}`,
    `  ${padLeft(orDash(r.actualMinutes, (v) => String(Math.round(v))), 7)}`,
    `  ${padLeft(orDash(r.estTokens, (v) => String(Math.round(v))), 10)}`
  ].join(''));
  return [head, ...lines].join('\n') + '\n';
};

export const renderVelocity = (v) => `Velocity: ${v.points} points over ${v.tasks} done task(s) in the last ${v.days} days (${v.pointsPerWeek} points per week).\n`;

/** `chemx team tokens --curve` (default) or `--velocity [--days=N]`. */
export const handleCurveCommand = (db, flags, isCli) => {
  const result = flags.velocity
    ? { velocity: velocity(db, { days: Number(flags.days) || 14 }) }
    : { curve: curveRows(db) };
  const isCliRun = isCli === true;
  if (!isCliRun) return result;
  const text = flags.velocity ? renderVelocity(result.velocity) : renderCurve(result.curve);
  process.stdout.write(flags.isJson ? `${JSON.stringify(result, null, 2)}\n` : text);
  return result;
};
