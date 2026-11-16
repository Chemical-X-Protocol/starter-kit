/**
 * Fibonacci points on a task, and the reports that relate them to tokens, cost and time.
 * `chemx team task points <id> <n>` sets the estimate. `chemx team tokens --curve` and `--velocity` read it back.
 * Measured figures come from the same sources as `chemx team tokens --epic`: the task's own telemetry first,
 * then imported run usage. A done task with no measured figures is counted as unmeasured, never as zero.
 */
import { figuresOf, usageByTask } from './team-tokens-epic.js';

export const FIBONACCI = Object.freeze([1, 2, 3, 5, 8, 13, 21]);
const DAY_MS = 86400000;
const SIZE_CLASS = Object.freeze({ 1: 'sand', 2: 'pebbles', 3: 'pebbles', 5: 'rocks', 8: 'boulders', 13: 'boulders' });

export const sizeClassOf = (points) => (points >= 21 ? 'epic' : SIZE_CLASS[points] || 'unknown');

const hasPointsColumn = (db) => db.prepare('PRAGMA table_info(agent_tasks)').all().some((col) => col.name === 'points');

/** Additive: an older board gains the points column the first time it opens. */
export const initPointsSchema = (db) => {
  const isMissing = Boolean(db) && !hasPointsColumn(db);
  if (!isMissing) return;
  try {
    db.exec('ALTER TABLE agent_tasks ADD COLUMN points INTEGER');
  } catch (err) {
    const isDuplicate = String(err.message).includes('duplicate column');
    if (!isDuplicate) throw err;
  }
};

/** Sets a task's points. Refuses any value outside the Fibonacci set. */
export const setPoints = (db, taskId, value) => {
  const id = Number(taskId);
  const points = Number(value);
  const isValid = FIBONACCI.includes(points);
  if (!isValid) return { error: `Points must be one of ${FIBONACCI.join(', ')}; got "${value}".` };
  const task = db.prepare('SELECT id FROM agent_tasks WHERE id = ?').get(id);
  if (!task) return { error: `Task #${taskId} not found.` };
  db.prepare('UPDATE agent_tasks SET points = ? WHERE id = ?').run(points, id);
  return { id, points, size: sizeClassOf(points) };
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

/** One row per point value: tasks done, how many have measured figures, and the median tokens, mean cost and median wall time of those. */
export const curveRows = (db) => {
  const tasks = doneEstimated(db);
  const usage = usageByTask(db, tasks.map((task) => task.id));
  const buckets = new Map();
  for (const task of tasks) {
    const bucket = buckets.get(task.points) || { points: task.points, size: sizeClassOf(task.points), tasks: 0, measured: 0, tokens: [], costs: [], walls: [] };
    bucket.tasks += 1;
    const figures = figuresOf(task, usage.get(task.id));
    if (figures.source) {
      bucket.measured += 1;
      bucket.tokens.push(figures.totalTokens);
      bucket.costs.push(figures.costUsd);
      bucket.walls.push(task.updated_at - task.created_at);
    }
    buckets.set(task.points, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.points - b.points).map((b) => ({
    points: b.points, size: b.size, tasks: b.tasks, measured: b.measured,
    medianTokens: median(b.tokens), meanCostUsd: mean(b.costs), medianWallMs: median(b.walls)
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

export const renderCurve = (rows) => {
  const hasRows = rows.length > 0;
  if (!hasRows) return 'No done tasks with points yet. Set points with: chemx team task points <id> <n>\n';
  const head = '  points  size       done  measured  median tokens  mean cost  median wall';
  const lines = rows.map((r) => {
    const tokens = r.medianTokens === null ? '-' : String(Math.round(r.medianTokens));
    const cost = r.meanCostUsd === null ? '-' : `$${r.meanCostUsd.toFixed(4)}`;
    const wall = r.medianWallMs === null ? '-' : `${Math.round(r.medianWallMs / 60000)}m`;
    return `  ${pad(r.points, 7)} ${pad(r.size, 10)} ${padLeft(r.tasks, 4)}  ${padLeft(r.measured, 8)}  ${padLeft(tokens, 13)}  ${padLeft(cost, 9)}  ${padLeft(wall, 11)}`;
  });
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
