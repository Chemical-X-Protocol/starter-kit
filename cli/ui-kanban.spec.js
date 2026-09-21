import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { createTask, requestFileLock } from './team/team-db.js';
import { UI_STYLES } from './ui-styles.js';
import { UI_TEMPLATE } from './ui-template.js';
import {
  KANBAN_COLUMNS,
  groupTasksByColumn,
  formatKanbanTokenStamp,
  VIEW_KANBAN_TEMPLATE
} from './ui-template-kanban.js';
import {
  handleUpdateTaskStatus,
  handleAssignTask,
  handleOverrideLock
} from './ui-actions.js';
import { routePost, routeGet } from './ui-server-routes.js';
import { handleSwarmStatus } from './ui-handlers.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
      tier TEXT NOT NULL, lines INTEGER NOT NULL, chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  initTeamSchema(db);
  return db;
};

test('ui-template-kanban: 5-column grouping categorizes all statuses correctly', () => {
  const sampleTasks = [
    { id: 1, title: 'Task 1', status: 'queued' },
    { id: 2, title: 'Task 2', status: 'in_progress' },
    { id: 3, title: 'Task 3', status: 'review' },
    { id: 4, title: 'Task 4', status: 'done' },
    { id: 5, title: 'Task 5', status: 'completed' },
    { id: 6, title: 'Task 6', status: 'blocked' },
    { id: 7, title: 'Task 7', status: 'failed' }
  ];

  const grouped = groupTasksByColumn(sampleTasks);
  assert.strictEqual(grouped.queued.length, 1);
  assert.strictEqual(grouped.in_progress.length, 1);
  assert.strictEqual(grouped.review.length, 1);
  assert.strictEqual(grouped.completed.length, 2);
  assert.strictEqual(grouped.blocked.length, 2);
  assert.strictEqual(KANBAN_COLUMNS.length, 5);
});

test('ui-template-kanban: token stamp is formatted to 4 decimals', () => {
  const stamp = formatKanbanTokenStamp({ prompt_tokens: 300, completion_tokens: 50, cost_usd: 0.0017 });
  assert.strictEqual(stamp, '[P: 300 | C: 50 | Cost: $0.0017]');
});

test('ui-styles: includes Kanban and task status styling', () => {
  assert.ok(UI_STYLES.includes('.xo-kanban'));
  assert.ok(UI_STYLES.includes('.xo-kanban-col'));
  assert.ok(UI_STYLES.includes('.xo-kanban-col__header'));
  assert.ok(UI_STYLES.includes('.xo-task-card'));
  assert.ok(UI_STYLES.includes('.xo-task-card__title'));
  assert.ok(UI_STYLES.includes('.xo-task-card__meta'));
  assert.ok(UI_STYLES.includes('.tier-atom'));
  assert.ok(UI_STYLES.includes('.tier-molecule'));
  assert.ok(UI_STYLES.includes('.xo-dot--active'));
  assert.ok(UI_STYLES.includes('.xo-dot--idle'));
  assert.ok(UI_STYLES.includes('.xo-dot'));
});

test('ui-template: includes Kanban template and M3 header indicator', () => {
  assert.ok(UI_TEMPLATE.includes('M3 Live Swarm'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('kanban-5col'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('kanban-create-form'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('kanban-leases'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('overrideLock'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('updateTaskStatus'));
  assert.ok(VIEW_KANBAN_TEMPLATE.includes('reassignTask'));
});

test('ui-actions: updates task status and blocked reason with feed logging', () => {
  const db = setupTestDb();
  const task = createTask(db, { title: 'Implement Kanban', tier: 'organism' });

  const res = handleUpdateTaskStatus(db, {
    taskId: task.id,
    status: 'blocked',
    blocked_reason: 'Waiting on design token review',
    agentId: '@worker_m3'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task.status, 'blocked');
  assert.strictEqual(res.task.blocked_reason, 'Waiting on design token review');

  const row = db.prepare('SELECT status, blocked_reason FROM agent_tasks WHERE id = ?').get(task.id);
  assert.strictEqual(row.status, 'blocked');
  assert.strictEqual(row.blocked_reason, 'Waiting on design token review');

  const feed = db.prepare('SELECT * FROM agent_feed WHERE task_id = ?').get(task.id);
  assert.ok(feed);
  assert.strictEqual(feed.event_type, 'task_status_updated');
  assert.ok(feed.message.includes('Waiting on design token review'));
});

test('ui-actions: reassigns task agent and logs feed event', () => {
  const db = setupTestDb();
  const task = createTask(db, { title: 'Audit Controller', tier: 'molecule' });

  const res = handleAssignTask(db, {
    taskId: task.id,
    agentId: 'architect'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.assigned_agent_id, '@architect');

  const row = db.prepare('SELECT assigned_agent_id FROM agent_tasks WHERE id = ?').get(task.id);
  assert.strictEqual(row.assigned_agent_id, '@architect');

  const feed = db.prepare('SELECT * FROM agent_feed WHERE task_id = ? AND event_type = ?').get(task.id, 'task_reassigned');
  assert.ok(feed);
  assert.ok(feed.message.includes('@architect'));
});

test('ui-actions: lock override forcefully releases lease and promotes waiter', () => {
  const db = setupTestDb();
  const path = 'src/shared/state.ts';

  const firstLock = requestFileLock(db, path, '@worker_1', { purpose: 'Initial lease' });
  assert.strictEqual(firstLock.granted, true);

  const queuedLock = requestFileLock(db, path, '@worker_2', { purpose: 'Queued lease' });
  assert.strictEqual(queuedLock.granted, false);

  const overrideRes = handleOverrideLock(db, {
    filePath: path,
    agentId: '@admin_user'
  });

  assert.strictEqual(overrideRes.success, true);
  assert.strictEqual(overrideRes.overridden, true);
  assert.strictEqual(overrideRes.previousHolder, '@worker_1');
  assert.strictEqual(overrideRes.promotedWaiter, '@worker_2');

  const activeLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(path);
  assert.strictEqual(activeLease.locked_by, '@worker_2');

  const feed = db.prepare("SELECT * FROM agent_feed WHERE event_type = 'lock_override'").get();
  assert.ok(feed);
  assert.ok(feed.message.includes('@admin_user'));
});

test('ui-server-routes: POST route aliases update tasks and override locks', () => {
  const db = setupTestDb();
  const task = createTask(db, { title: 'Route Test Task', tier: 'atom' });

  const updateRes1 = routePost('/api/tasks/update', db, { taskId: task.id, status: 'review' });
  assert.strictEqual(updateRes1.success, true);
  assert.strictEqual(updateRes1.task.status, 'review');

  const updateRes2 = routePost('/api/swarm/tasks/update', db, { taskId: task.id, status: 'done' });
  assert.strictEqual(updateRes2.success, true);
  assert.strictEqual(updateRes2.task.status, 'done');

  const assignRes1 = routePost('/api/tasks/assign', db, { taskId: task.id, agentId: '@specialist' });
  assert.strictEqual(assignRes1.success, true);
  assert.strictEqual(assignRes1.assigned_agent_id, '@specialist');

  const assignRes2 = routePost('/api/swarm/tasks/assign', db, { taskId: task.id, agentId: '@reviewer' });
  assert.strictEqual(assignRes2.success, true);
  assert.strictEqual(assignRes2.assigned_agent_id, '@reviewer');

  const path = 'src/test/file.ts';
  requestFileLock(db, path, '@holder', { purpose: 'Hold file' });
  const overrideRes = routePost('/api/locks/override', db, { filePath: path, agentId: '@override_agent' });
  assert.strictEqual(overrideRes.success, true);
  assert.strictEqual(overrideRes.overridden, true);

  const swarmOverrideRes = routePost('/api/swarm/locks/override', db, { filePath: path, agentId: '@override_agent' });
  assert.strictEqual(swarmOverrideRes.success, true);
});

test('ui-handlers: handleSwarmStatus returns enriched tasks with token stamps', () => {
  const db = setupTestDb();
  createTask(db, {
    title: 'Enriched Task',
    tier: 'molecule',
    priority: 1,
    status: 'in_progress',
    assigned_agent_id: '@worker_m3'
  });

  const status = handleSwarmStatus(db);
  assert.strictEqual(status.success, true);
  const task = status.tasks.find((t) => t.title === 'Enriched Task');
  assert.ok(task);
  assert.strictEqual(task.tier, 'molecule');
  assert.strictEqual(task.priority, 1);
  assert.strictEqual(task.assignedAgentId, '@worker_m3');
  assert.ok(task.tokenStamp.startsWith('[P:'));
  assert.ok(task.tokenStamp.includes('Cost: $'));
});
