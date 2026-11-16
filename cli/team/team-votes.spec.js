import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initVotesSchema, recordBatch, recordVote, settle, spread, votesFor } from './team-votes.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initVotesSchema(db); return db; };

test('settle: rounds the mean up to the next Fibonacci interval', () => {
  assert.deepEqual(settle([5, 3, 3]), { average: 3.67, estimate: 5 });
  assert.deepEqual(settle([2, 3, 2]), { average: 2.33, estimate: 3 });
  assert.deepEqual(settle([8, 8]), { average: 8, estimate: 8 });
  assert.deepEqual(settle([]), { average: null, estimate: null });
});

test('spread: more than one Fibonacci step is an outlier', () => {
  assert.deepEqual(spread([3, 5]), { steps: 1, isOutlier: false });
  assert.deepEqual(spread([2, 13, 5]), { steps: 4, isOutlier: true });
  assert.equal(spread([5, 5]).isOutlier, false);
});

test('recordVote: refuses a non-Fibonacci vote and writes nothing', () => {
  const db = freshDb();
  assert.throws(() => recordVote(db, { taskId: 1, voter: '@a', points: 4, round: 1 }), /Fibonacci|one of/);
  assert.equal(votesFor(db, 1, 1).length, 0);
});

test('recordVote: upserts by task, voter and round', () => {
  const db = freshDb();
  recordVote(db, { taskId: 1, voter: '@a', points: 3, why: 'small', round: 1, now: 1 });
  recordVote(db, { taskId: 1, voter: '@a', points: 5, why: 'bigger', round: 1, now: 2 });
  recordVote(db, { taskId: 1, voter: '@a', points: 8, round: 2, now: 3 });
  const roundOne = votesFor(db, 1, 1);
  assert.equal(roundOne.length, 1);
  assert.equal(roundOne[0].points, 5);
  assert.equal(roundOne[0].why, 'bigger');
  assert.equal(votesFor(db, 1, 2)[0].points, 8);
});

test('recordBatch: records every row in one transaction', () => {
  const db = freshDb();
  const count = recordBatch(db, '@a', [{ task: 1, points: 2, why: 'x' }, { task: 2, points: 13, why: 'y' }], { round: 2, now: 9 });
  assert.equal(count, 2);
  assert.equal(votesFor(db, 2, 2)[0].points, 13);
});

test('recordBatch: one bad row refuses the whole batch', () => {
  const db = freshDb();
  assert.throws(() => recordBatch(db, '@a', [{ task: 1, points: 2 }, { task: 2, points: 4 }]), /one of/);
  assert.equal(votesFor(db, 1, 1).length, 0);
});
