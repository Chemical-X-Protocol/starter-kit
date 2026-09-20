import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { handleSwarmStatus } from './ui-handlers.js';
import { routeGet, routePost } from './ui-server-routes.js';
import { startUiServer } from './ui-server.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  initTeamSchema(db);
  return db;
};

test('ui-handlers: handleSwarmStatus returns clean arrays for leases, waitingLocks, tasks, and agents', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, heartbeat) VALUES ('@agent-1', 'Agent 1', 'worker', ?)").run(now);
  db.prepare("INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES ('src/test.ts', '@agent-1', ?, ?, 'editing')").run(now, now + 60000);
  db.prepare("INSERT INTO file_lock_queue (file_path, agent_id, requested_at, status, priority, purpose) VALUES ('src/test.ts', '@agent-2', ?, 'waiting', 1, 'waiting lock')").run(now);
  db.prepare("INSERT INTO agent_tasks (title, tier, status, created_at, updated_at) VALUES ('Canonical Task', 'backend', 'todo', ?, ?)").run(now, now);

  const status = handleSwarmStatus(db);
  assert.strictEqual(status.success, true);
  assert.ok(Array.isArray(status.leases));
  assert.ok(Array.isArray(status.waitingLocks));
  assert.ok(Array.isArray(status.tasks));
  assert.ok(Array.isArray(status.agents));

  assert.strictEqual(status.leases.length, 1);
  assert.strictEqual(status.leases[0].filePath, 'src/test.ts');
  assert.strictEqual(status.leases[0].lockedBy, '@agent-1');
  assert.strictEqual(status.leases[0].waitingCount, 1);

  assert.strictEqual(status.waitingLocks.length, 1);
  assert.strictEqual(status.waitingLocks[0].filePath, 'src/test.ts');
  assert.strictEqual(status.waitingLocks[0].agentId, '@agent-2');

  assert.strictEqual(status.tasks.length, 1);
  assert.strictEqual(status.tasks[0].title, 'Canonical Task');

  assert.strictEqual(status.agents.length, 1);
  assert.strictEqual(status.agents[0].id, '@agent-1');
});

test('ui-server-routes: routeGet resolves canonical aliases /api/status, /api/feed, /api/tasks', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agent_tasks (title, tier, status, created_at, updated_at) VALUES ('Route Task', 'backend', 'todo', ?, ?)").run(now, now);
  db.prepare("INSERT INTO agent_feed (author_id, event_type, message, timestamp) VALUES ('@agent-1', 'broadcast', 'Route Feed Message', ?)").run(now);

  const statusRes = routeGet('/api/status', db);
  assert.ok(statusRes);
  assert.strictEqual(statusRes.success, true);
  assert.ok(Array.isArray(statusRes.leases));
  assert.ok(Array.isArray(statusRes.waitingLocks));

  const feedRes = routeGet('/api/feed', db);
  assert.ok(feedRes);
  assert.strictEqual(feedRes.success, true);
  assert.ok(Array.isArray(feedRes.feed));
  assert.ok(feedRes.feed.some((f) => f.message === 'Route Feed Message'));

  const tasksRes = routeGet('/api/tasks', db);
  assert.ok(tasksRes);
  assert.strictEqual(tasksRes.success, true);
  assert.ok(Array.isArray(tasksRes.tasks));
  assert.ok(tasksRes.tasks.some((t) => t.title === 'Route Task'));
});

test('ui-server-routes: routePost resolves canonical aliases /api/feed and /api/tasks', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, heartbeat) VALUES ('@tester', 'Tester', 'qa', ?)").run(now);

  const postFeedRes = routePost('/api/feed', db, {
    author: '@tester',
    message: 'Canonical post test',
    channel: 'general'
  });
  assert.ok(postFeedRes);
  assert.strictEqual(postFeedRes.success, true);

  const postTaskRes = routePost('/api/tasks', db, {
    title: 'Created via canonical route',
    tier: 'backend'
  });
  assert.ok(postTaskRes);
  assert.strictEqual(postTaskRes.success, true);

  const tasksRes = routeGet('/api/tasks', db);
  assert.ok(tasksRes.tasks.some((t) => t.title === 'Created via canonical route'));
});

test('ui-server: HTTP integration serves canonical routes /api/status, /api/feed, /api/tasks', async () => {
  const running = await startUiServer({ port: 0, cwd: process.cwd() });
  try {
    const resStatus = await fetch(`http://localhost:${running.port}/api/status`);
    assert.strictEqual(resStatus.status, 200);
    const jsonStatus = await resStatus.json();
    assert.strictEqual(jsonStatus.success, true);
    assert.ok(Array.isArray(jsonStatus.waitingLocks));

    const resFeed = await fetch(`http://localhost:${running.port}/api/feed`);
    assert.strictEqual(resFeed.status, 200);
    const jsonFeed = await resFeed.json();
    assert.strictEqual(jsonFeed.success, true);
    assert.ok(Array.isArray(jsonFeed.feed));

    const resTasks = await fetch(`http://localhost:${running.port}/api/tasks`);
    assert.strictEqual(resTasks.status, 200);
    const jsonTasks = await resTasks.json();
    assert.strictEqual(jsonTasks.success, true);
    assert.ok(Array.isArray(jsonTasks.tasks));
  } finally {
    running.server.close();
  }
});
