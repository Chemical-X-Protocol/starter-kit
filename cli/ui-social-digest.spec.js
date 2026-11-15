import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { buildDigest, resolveSince, localMidnight, getRoutes, API_DOCS } from './ui-social-digest.js';
import { socialGetRoutes } from './ui-social-routes.js';

const NOW = new Date(2026, 10, 15, 15, 30).getTime();
const MIDNIGHT = new Date(2026, 10, 15, 0, 0).getTime();

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};
const post = (db, author, type, timestamp, metadata = '{}') => db
  .prepare('INSERT INTO agent_feed (timestamp, author_id, event_type, message, metadata) VALUES (?, ?, ?, ?, ?)')
  .run(timestamp, author, type, 'm', metadata);
const addTask = (db, title, status) => db
  .prepare('INSERT INTO agent_tasks (title, status, created_at, updated_at) VALUES (?, ?, 1, 1)')
  .run(title, status);

test('ui-social-digest: since defaults to local midnight and rejects junk', () => {
  assert.strictEqual(localMidnight(NOW), MIDNIGHT);
  assert.strictEqual(resolveSince(undefined, NOW), MIDNIGHT);
  assert.strictEqual(resolveSince('abc', NOW), MIDNIGHT);
  assert.strictEqual(resolveSince('-5', NOW), MIDNIGHT);
  assert.strictEqual(resolveSince('', NOW), MIDNIGHT);
  assert.strictEqual(resolveSince('1700000000000', NOW), 1700000000000);
});

test('ui-social-digest: empty db has zero counts and hasActivity false', () => {
  const d = buildDigest(setupDb(), {}, NOW);
  assert.strictEqual(d.since, MIDNIGHT);
  assert.deepStrictEqual([d.commits, d.tasksCompleted, d.tasksCreated, d.handoffs, d.decisions, d.openBlockers], [0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(d.agents, []);
  assert.strictEqual(d.hasActivity, false);
});

test('ui-social-digest: counts events since the cutoff only, ignoring archived rows', () => {
  const db = setupDb();
  const t = MIDNIGHT + 1000;
  post(db, '@a', 'commit', t);
  post(db, '@a', 'commit', t);
  post(db, '@a', 'commit', MIDNIGHT - 1000);
  post(db, '@b', 'task_complete', t);
  post(db, '@b', 'task_created', t);
  post(db, '@b', 'task_handoff', t);
  post(db, '@b', 'decision', t);
  post(db, '@b', 'decision', t, '{"archived":1}');
  const d = buildDigest(db, {}, NOW);
  assert.deepStrictEqual([d.commits, d.tasksCompleted, d.tasksCreated, d.handoffs, d.decisions], [2, 1, 1, 1, 1]);
  assert.strictEqual(d.hasActivity, true);
  assert.strictEqual(buildDigest(db, { since: String(MIDNIGHT - 5000) }, NOW).commits, 3);
});

test('ui-social-digest: top 5 agents by posts, lock churn excluded', () => {
  const db = setupDb();
  const t = MIDNIGHT + 1000;
  ['@a', '@b', '@c', '@d', '@e', '@f'].forEach((h, i) => {
    for (let n = 0; n <= 6 - i; n += 1) post(db, h, 'status_update', t);
  });
  for (let n = 0; n < 50; n += 1) post(db, '@locker', 'lock_acquired', t);
  const { agents } = buildDigest(db, {}, NOW);
  assert.strictEqual(agents.length, 5);
  assert.deepStrictEqual(agents.map((a) => a.handle), ['@a', '@b', '@c', '@d', '@e']);
  assert.strictEqual(agents[0].posts, 7);
});

test('ui-social-digest: open blockers count blocked tasks now', () => {
  const db = setupDb();
  addTask(db, 'stuck', 'blocked');
  addTask(db, 'fine', 'queued');
  const d = buildDigest(db, {}, NOW);
  assert.strictEqual(d.openBlockers, 1);
  assert.deepStrictEqual(d.blockers.map((b) => b.title), ['stuck']);
});

test('ui-social-digest: served at /api/digest/today through the social routes and documented', () => {
  const db = setupDb();
  post(db, '@a', 'commit', Date.now());
  const route = socialGetRoutes(db, {})['/api/digest/today'];
  assert.strictEqual(typeof route, 'function');
  assert.strictEqual(route().success, true);
  assert.strictEqual(getRoutes(db, {})['/api/digest/today']().since, localMidnight());
  assert.strictEqual(API_DOCS[0].path, '/api/digest/today');
});
