/**
 * Planning-poker votes per task. Votes are Fibonacci points, one per (task, voter, round).
 * settle() turns round-two votes into an average and the next Fibonacci interval at or above it;
 * spread() flags an outlier when the highest and lowest vote sit more than one Fibonacci step apart.
 */
import { FIBONACCI } from './team-points.js';
import { readRun } from './usage-reader.js';
import { priceRun } from './usage-compute.js';
import { loadPricing } from './usage-pricing.js';

export const initVotesSchema = (db) => {
  db.exec(`CREATE TABLE IF NOT EXISTS estimate_votes (
    task_id INTEGER, voter TEXT, round INTEGER, points INTEGER, why TEXT, at INTEGER,
    PRIMARY KEY (task_id, voter, round))`);
};

const asPoints = (votes) => votes.map((vote) => (typeof vote === 'object' ? vote.points : vote));

const checkVote = ({ taskId, voter, points }) => {
  const isFibonacci = FIBONACCI.includes(points);
  if (!isFibonacci) throw new Error(`Vote must be one of ${FIBONACCI.join(', ')}; got ${points}`);
  const hasTask = Number.isInteger(Number(taskId)) && Number(taskId) > 0;
  if (!hasTask) throw new Error(`Invalid task id: ${taskId}`);
  const hasVoter = typeof voter === 'string' && voter.length > 0;
  if (!hasVoter) throw new Error('A vote needs a voter');
};

const upsert = (db, { taskId, voter, points, why, round = 1, now = Date.now() }) => {
  db.prepare(`INSERT INTO estimate_votes (task_id, voter, round, points, why, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (task_id, voter, round) DO UPDATE SET points = excluded.points, why = excluded.why, at = excluded.at`)
    .run(Number(taskId), voter, round, points, why ?? '', now);
};

export const recordVote = (db, vote) => {
  checkVote(vote);
  initVotesSchema(db);
  upsert(db, vote);
  return { taskId: Number(vote.taskId), voter: vote.voter, round: vote.round ?? 1, points: vote.points };
};

export const votesFor = (db, taskId, round = 1) => {
  initVotesSchema(db);
  return db.prepare('SELECT task_id AS taskId, voter, round, points, why, at FROM estimate_votes WHERE task_id = ? AND round = ? ORDER BY voter')
    .all(Number(taskId), round);
};

export const settle = (votes) => {
  const points = asPoints(votes || []);
  const isEmpty = points.length === 0;
  if (isEmpty) return { average: null, estimate: null };
  const average = points.reduce((sum, p) => sum + p, 0) / points.length;
  const estimate = FIBONACCI.find((p) => p >= average) ?? FIBONACCI[FIBONACCI.length - 1];
  return { average: Math.round(average * 100) / 100, estimate };
};

export const spread = (votes) => {
  const points = asPoints(votes || []);
  const isEmpty = points.length === 0;
  if (isEmpty) return { steps: 0, isOutlier: false };
  const steps = FIBONACCI.indexOf(Math.max(...points)) - FIBONACCI.indexOf(Math.min(...points));
  const isOutlier = steps > 1;
  return { steps, isOutlier };
};

const priceVoteRun = (runDir, cwd) => {
  const run = readRun(runDir);
  return run ? { totals: priceRun(run, loadPricing(cwd)).totals, runs: run.agents.length } : null;
};

/** Cost of a vote run, read from its subagent transcripts: {tokens, costUsd, runs}. A missing dir is zero runs. */
export const costForVoteRun = (runDir, cwd = process.cwd()) => {
  const priced = priceVoteRun(runDir, cwd);
  if (!priced) return { tokens: 0, costUsd: 0, runs: 0 };
  return { tokens: priced.totals.total, costUsd: priced.totals.cost, runs: priced.runs };
};

const writeRunTelemetry = (db, taskId, totals) => {
  const prompt = totals.input + totals.write5m + totals.write1h;
  db.prepare('UPDATE agent_tasks SET prompt_tokens=?, completion_tokens=?, cached_tokens=?, total_tokens=?, cost_usd=?, telemetry_source=? WHERE id=?')
    .run(prompt, totals.output, totals.cacheRead, totals.total, totals.cost, 'run usage', taskId);
};

// A run prices the whole batch, so it is attributed only when the batch votes on a single task.
// Unknown is never zero: a run with no transcripts or no counted tokens leaves the task alone.
const attachRunCost = (db, list, runDir) => {
  const taskIds = [...new Set(list.map((row) => Number(row.task)))];
  const priced = priceVoteRun(runDir, process.cwd());
  const isMeasured = Boolean(priced) && priced.runs > 0 && priced.totals.total > 0;
  const isOneTask = taskIds.length === 1;
  const canAttach = isMeasured && isOneTask;
  if (!canAttach) return;
  writeRunTelemetry(db, taskIds[0], priced.totals);
};

export const recordBatch = (db, voter, rows, { round = 1, now = Date.now(), runDir } = {}) => {
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row) => checkVote({ taskId: row.task, voter, points: row.points }));
  initVotesSchema(db);
  db.exec('BEGIN');
  try {
    list.forEach((row) => upsert(db, { taskId: row.task, voter, points: row.points, why: row.why, round, now }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const hasRun = Boolean(runDir);
  if (hasRun) attachRunCost(db, list, runDir);
  return list.length;
};
