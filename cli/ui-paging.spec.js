import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { createTask, postFeedEvent, registerAgent } from './team/team-db.js';
import { readPageParams, pageEnvelope } from './ui-paging.js';
import { listTasksPage, listTaskBoard } from './ui-paging-tasks.js';
import { listAgentsPage } from './ui-paging-agents.js';
import { routeGet } from './ui-server-routes.js';
import { handleSwarmStatus, LIVE_TASK_LIMIT } from './ui-handlers.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const seedTasks = (db, count, extra = {}) => {
  for (let i = 1; i <= count; i += 1) createTask(db, { title: `Task ${i}`, priority: 2, ...extra });
};

test('ui-paging: page params clamp the limit and accept offset or page', () => {
  assert.deepStrictEqual(readPageParams({}), { limit: 25, offset: 0 });
  assert.deepStrictEqual(readPageParams({ limit: '5000' }), { limit: 200, offset: 0 });
  assert.deepStrictEqual(readPageParams({ limit: '10', page: '3' }), { limit: 10, offset: 20 });
  assert.deepStrictEqual(readPageParams({ limit: '10', offset: '7', page: '3' }), { limit: 10, offset: 7 }, 'offset wins over page');
  assert.deepStrictEqual(pageEnvelope(12, { limit: 5, offset: 10 }, 2),
    { total: 12, limit: 5, offset: 10, page: 3, totalPages: 3, hasMore: false, nextOffset: null });
});

test('ui-paging: listTasksPage walks every task once through nextOffset', () => {
  const db = setupDb();
  seedTasks(db, 12);
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 10 && offset !== null; guard += 1) {
    const page = listTasksPage(db, { limit: '5', offset: String(offset) });
    assert.strictEqual(page.total, 12);
    seen.push(...page.tasks.map((t) => t.id));
    offset = page.nextOffset;
  }
  assert.strictEqual(seen.length, 12);
  assert.strictEqual(new Set(seen).size, 12);
});

test('ui-paging: task cards are slim and enriched; full=1 returns whole rows', () => {
  const db = setupDb();
  const parent = createTask(db, { title: 'Parent', description: 'long body', tier: 'molecule' });
  createTask(db, { title: 'Child', parent_id: parent.id });
  const card = listTasksPage(db, { q: 'Parent' }).tasks[0];
  assert.strictEqual(card.subtaskCount, 1);
  assert.strictEqual(card.tier, 'molecule');
  assert.strictEqual(card.description, undefined, 'cards leave the description to /api/tasks/:id');
  assert.strictEqual(card.tokenStamp, '[tokens: unknown]');
  const full = listTasksPage(db, { q: 'Parent', full: '1' }).tasks[0];
  assert.strictEqual(full.description, 'long body');
});

test('ui-paging: status aliases, tier, hideTests and q (#id) filter in SQL', () => {
  const db = setupDb();
  createTask(db, { title: 'Done one', status: 'done' });
  createTask(db, { title: 'Completed one', status: 'completed' });
  createTask(db, { title: 'E2E Verify Task 1' });
  const atom = createTask(db, { title: 'Atom work', tier: 'atom', target_path: 'src/a-button.vue' });
  assert.strictEqual(listTasksPage(db, { status: 'done' }).total, 2, 'done includes completed');
  assert.strictEqual(listTasksPage(db, { status: 'queued', hideTests: '1' }).total, 1);
  assert.strictEqual(listTasksPage(db, { tier: 'atom' }).total, 1);
  assert.strictEqual(listTasksPage(db, { q: 'a-button' }).tasks[0].id, atom.id, 'q matches the target path');
  assert.strictEqual(listTasksPage(db, { q: `#${atom.id}` }).tasks[0].id, atom.id, 'q matches #id');
  assert.strictEqual(listTasksPage(db, { q: '100%' }).total, 0, '% in q is literal');
});

test('ui-paging: the board pages each column on its own', () => {
  const db = setupDb();
  seedTasks(db, 30);
  seedTasks(db, 3, { status: 'blocked' });
  const board = listTaskBoard(db, { limit: '10' }).columns;
  assert.strictEqual(board.queued.total, 30);
  assert.strictEqual(board.queued.tasks.length, 10);
  assert.strictEqual(board.queued.nextOffset, 10);
  assert.strictEqual(board.blocked.total, 3);
  assert.strictEqual(board.done.total, 0);
});

test('ui-paging: agents page newest heartbeat first with per-status counts', () => {
  const db = setupDb();
  for (let i = 1; i <= 4; i += 1) registerAgent(db, { id: `@a${i}`, name: `A${i}`, role: 'worker' });
  db.prepare("UPDATE agents SET status = 'busy', heartbeat = 9999999999999 WHERE id = '@a3'").run();
  const page = listAgentsPage(db, { limit: '2' });
  assert.strictEqual(page.total, 4);
  assert.strictEqual(page.agents[0].id, '@a3');
  assert.strictEqual(page.hasMore, true);
  assert.strictEqual(page.counts.active, 1);
  assert.strictEqual(listAgentsPage(db, { status: 'active' }).total, 1);
});

test('ui-paging: the live status view stays bounded however many tasks exist', () => {
  const db = setupDb();
  seedTasks(db, LIVE_TASK_LIMIT + 20);
  const status = handleSwarmStatus(db);
  assert.strictEqual(status.tasks.length, LIVE_TASK_LIMIT);
  assert.strictEqual(status.tasksTotal, LIVE_TASK_LIMIT + 20);
  assert.strictEqual(status.taskCounts.queued, LIVE_TASK_LIMIT + 20);
});

test('ui-paging: /api/feed pages backwards with before_id, and /api/ describes the API', () => {
  const db = setupDb();
  for (let i = 1; i <= 5; i += 1) postFeedEvent(db, { author_id: '@a', event_type: 'broadcast', message: `m${i}`, channel: 'general' });
  const newest = routeGet('/api/feed?limit=2', db);
  assert.deepStrictEqual(newest.feed.map((p) => p.message), ['m4', 'm5']);
  assert.strictEqual(newest.hasMore, true);
  const older = routeGet(`/api/feed?limit=2&before_id=${newest.oldestId}`, db);
  assert.deepStrictEqual(older.feed.map((p) => p.message), ['m2', 'm3']);
  const index = routeGet('/api/', db);
  assert.ok(index.endpoints.some((e) => e.path === '/api/tasks'));
  assert.ok(index.pagination.envelope.includes('nextOffset'));
});
