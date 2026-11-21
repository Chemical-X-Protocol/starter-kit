import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { breakdownGate, curveRows, renderCurve, setPoints, sizeClassOf, velocity } from './team-points.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };
const DAY_MS = 86400000;

const finishTask = (db, id, { points, measured = false, ageDays = 0 }) => {
  setPoints(db, id, points);
  const updatedAt = Date.now() - ageDays * DAY_MS;
  db.prepare("UPDATE agent_tasks SET status = 'done', updated_at = ? WHERE id = ?").run(updatedAt, id);
  if (measured) db.prepare("UPDATE agent_tasks SET telemetry_source = 'task', total_tokens = 1000, cost_usd = 0.01 WHERE id = ?").run(id);
};

test('team points: each Fibonacci value names its size class', () => {
  assert.deepEqual([1, 3, 5, 8, 13, 21].map(sizeClassOf), ['sand', 'pebbles', 'rocks', 'boulders', 'boulders', 'epic']);
});

test('team points: only Fibonacci values are set, and only on a task that exists', () => {
  const db = freshDb();
  const task = createTask(db, { title: 'a task' });
  assert.ok(setPoints(db, task.id, 4).error, '4 is not on the scale');
  assert.equal(setPoints(db, task.id, 5).points, 5);
  assert.ok(setPoints(db, 999, 5).error, 'unknown task is refused');
});

test('team points: the curve groups done tasks by points and keeps unmeasured ones out of the averages', () => {
  const db = freshDb();
  const three = createTask(db, { title: 'three' });
  const fiveMeasured = createTask(db, { title: 'five measured' });
  const fiveBare = createTask(db, { title: 'five bare' });
  finishTask(db, three.id, { points: 3 });
  finishTask(db, fiveMeasured.id, { points: 5, measured: true });
  finishTask(db, fiveBare.id, { points: 5 });
  const rows = curveRows(db);
  assert.deepEqual(rows.map((r) => [r.points, r.tasks, r.measured]), [[3, 1, 0], [5, 2, 1]]);
  assert.equal(rows[0].medianTokens, null, 'no measured figures is unknown, not zero');
  assert.equal(rows[1].medianTokens, 1000);
  assert.equal(rows[1].meanCostUsd, 0.01);
  assert.match(renderCurve(rows), /rocks/);
});

test('team points: a task of 8 points or more is refused until it has child tasks', () => {
  const db = freshDb();
  const big = createTask(db, { title: 'big' });
  const small = createTask(db, { title: 'small' });
  setPoints(db, big.id, 8);
  setPoints(db, small.id, 5);
  assert.deepEqual(breakdownGate(db, small.id), { ok: true }, 'under 8 is never gated');
  const refused = breakdownGate(db, big.id);
  assert.match(refused.error, /Break it down first/);
  assert.match(refused.error, new RegExp(`--parent=${big.id}`));
  const child = createTask(db, { title: 'child of big' });
  db.prepare('UPDATE agent_tasks SET parent_id = ? WHERE id = ?').run(big.id, child.id);
  assert.deepEqual(breakdownGate(db, big.id), { ok: true }, 'a child task lifts the gate');
});

test('team points: a task with no points, or an unknown task, is not gated here', () => {
  const db = freshDb();
  const bare = createTask(db, { title: 'bare' });
  assert.deepEqual(breakdownGate(db, bare.id), { ok: true });
  assert.deepEqual(breakdownGate(db, 999), { ok: true });
});

test('team points: velocity sums the points finished inside the window only', () => {
  const db = freshDb();
  const recent = createTask(db, { title: 'recent' });
  const old = createTask(db, { title: 'old' });
  finishTask(db, recent.id, { points: 3 });
  finishTask(db, old.id, { points: 8, ageDays: 30 });
  const v = velocity(db, { days: 14 });
  assert.equal(v.points, 3);
  assert.equal(v.tasks, 1);
  assert.equal(v.pointsPerWeek, 1.5);
});
