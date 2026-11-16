/**
 * Planning-poker votes per task. Votes are Fibonacci points, one per (task, voter, round).
 * settle() turns round-two votes into an average and the next Fibonacci interval at or above it;
 * spread() flags an outlier when the highest and lowest vote sit more than one Fibonacci step apart.
 */
import { FIBONACCI } from './team-points.js';

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

export const recordBatch = (db, voter, rows, { round = 1, now = Date.now() } = {}) => {
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
  return list.length;
};
