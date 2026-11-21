import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, getTask } from './team-db-tasks.js';
import { costForVoteRun, initVotesSchema, recordBatch, recordVote, revealRound, settle, spread, votesFor } from './team-votes.js';

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

const makeRun = (t, transcripts) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-vote-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir);
  transcripts.forEach((usage, i) => {
    const line = { type: 'assistant', uuid: `u${i}`, message: { id: `m${i}`, model: 'claude-sonnet-4-5', usage } };
    fs.writeFileSync(path.join(runDir, `agent-a${i}.jsonl`), `${JSON.stringify(line)}\n`);
  });
  return { root, runDir, db: openIndexDb(root, { fresh: true }) };
};

test('costForVoteRun: prices a run from its transcripts', (t) => {
  const { runDir } = makeRun(t, [{ input_tokens: 1000, output_tokens: 500 }, { input_tokens: 200, output_tokens: 100 }]);
  const cost = costForVoteRun(runDir);
  assert.equal(cost.runs, 2);
  assert.equal(cost.tokens, 1800);
  assert.ok(cost.costUsd > 0);
});

test('recordBatch: a measured runDir stamps the vote task with run usage', (t) => {
  const { db, runDir } = makeRun(t, [{ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 300 }]);
  const task = createTask(db, { title: 'vote task' });
  recordBatch(db, '@a', [{ task: task.id, points: 3 }], { runDir });
  const row = getTask(db, task.id);
  assert.equal(row.telemetry_source, 'run usage');
  assert.equal(row.prompt_tokens, 1000);
  assert.equal(row.completion_tokens, 500);
  assert.equal(row.cached_tokens, 300);
  assert.equal(row.total_tokens, 1800);
  assert.ok(row.cost_usd > 0);
});

test('recordBatch: a run with no transcripts leaves the task unchanged', (t) => {
  const { db, runDir } = makeRun(t, []);
  const task = createTask(db, { title: 'vote task' });
  const before = getTask(db, task.id);
  recordBatch(db, '@a', [{ task: task.id, points: 3 }], { runDir });
  const after = getTask(db, task.id);
  assert.equal(after.telemetry_source ?? null, null);
  assert.deepEqual(after, before);
  assert.equal(votesFor(db, task.id, 1).length, 1);
});

test('revealRound: a two-step spread flags an outlier, one step does not', () => {
  const wide = revealRound([{ voter: '@b', points: 5 }, { voter: '@a', points: 2 }, { voter: '@c', points: 3 }]);
  assert.deepEqual(wide.votes.map((v) => v.voter), ['@a', '@c', '@b']);
  assert.equal(wide.spread, 2);
  assert.equal(wide.isOutlier, true);
  assert.deepEqual(wide.settled, { average: 3.33, estimate: 5 });
  const close = revealRound([{ voter: '@a', points: 3 }, { voter: '@b', points: 5 }]);
  assert.equal(close.spread, 1);
  assert.equal(close.isOutlier, false);
  assert.equal(revealRound([]).isOutlier, false);
});

test('recordBatch: one bad row refuses the whole batch', () => {
  const db = freshDb();
  assert.throws(() => recordBatch(db, '@a', [{ task: 1, points: 2 }, { task: 2, points: 4 }]), /one of/);
  assert.equal(votesFor(db, 1, 1).length, 0);
});
