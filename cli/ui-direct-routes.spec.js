import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { routeGet } from './ui-server-routes.js';
import { startUiServer } from './ui-server.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('ui-server-routes: routeGet resolves single task via /api/tasks/:id', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agent_tasks (id, title, tier, status, created_at, updated_at) VALUES (42, 'Direct Route Task', 'organism', 'in_progress', ?, ?)").run(now, now);

  const foundRes = routeGet('/api/tasks/42', db);
  assert.ok(foundRes);
  assert.strictEqual(foundRes.success, true);
  assert.strictEqual(foundRes.task.id, 42);
  assert.strictEqual(foundRes.task.title, 'Direct Route Task');

  const missingRes = routeGet('/api/tasks/9999', db);
  assert.ok(missingRes);
  assert.strictEqual(missingRes.success, false);
  assert.strictEqual(missingRes.error, 'Task not found');
});

test('ui-server: HTTP integration serves SPA HTML on direct frontend routes /tasks and /tasks/:id', async () => {
  const running = await startUiServer({ port: 0, cwd: process.cwd() });
  try {
    // Direct link to /tasks
    const resTasks = await fetch(`http://localhost:${running.port}/tasks`);
    assert.strictEqual(resTasks.status, 200);
    assert.strictEqual(resTasks.headers.get('content-type'), 'text/html; charset=utf-8');
    const htmlTasks = await resTasks.text();
    assert.ok(htmlTasks.includes('Chemical X'));

    // Direct link to /tasks/42
    const resSingleTask = await fetch(`http://localhost:${running.port}/tasks/42`);
    assert.strictEqual(resSingleTask.status, 200);
    assert.strictEqual(resSingleTask.headers.get('content-type'), 'text/html; charset=utf-8');
    const htmlSingleTask = await resSingleTask.text();
    assert.ok(htmlSingleTask.includes('Chemical X'));

    // Direct link to /database
    const resDb = await fetch(`http://localhost:${running.port}/database`);
    assert.strictEqual(resDb.status, 200);
    assert.strictEqual(resDb.headers.get('content-type'), 'text/html; charset=utf-8');
  } finally {
    running.server.close();
  }
});
