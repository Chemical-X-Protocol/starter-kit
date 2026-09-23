import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, listTasks } from './team-db-tasks.js';
import { buildTaskListQuery } from './team-db-task-helpers.js';
import { formatTaskListCard } from './team-format.js';
import { handleChemxTeamTask } from '../mcp/tools-team.js';
import { openIndexDb } from '../search-db.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('buildTaskListQuery and listTasks filter by parent_id', () => {
  const db = setupDb();
  const rootTask = createTask(db, { title: 'Parent Epic', tier: 'organism' });
  const childTask = createTask(db, { title: 'Child Subtask', parent_id: rootTask.id, tier: 'molecule' });
  const otherRoot = createTask(db, { title: 'Other Root Task', tier: 'atom' });

  const rootQuery = buildTaskListQuery({ parentId: 'root' });
  assert.ok(rootQuery.query.includes('parent_id IS NULL'));

  const childQuery = buildTaskListQuery({ parentId: rootTask.id });
  assert.ok(childQuery.query.includes('parent_id = ?'));
  assert.strictEqual(childQuery.params[0], rootTask.id);

  const rootTasks = listTasks(db, { parentId: 'root' });
  assert.strictEqual(rootTasks.length, 2);
  const rootIds = rootTasks.map((t) => t.id);
  assert.ok(rootIds.includes(rootTask.id));
  assert.ok(rootIds.includes(otherRoot.id));
  assert.ok(!rootIds.includes(childTask.id));

  const subTasks = listTasks(db, { parentId: rootTask.id });
  assert.strictEqual(subTasks.length, 1);
  assert.strictEqual(subTasks[0].id, childTask.id);
  assert.strictEqual(subTasks[0].parent_id, rootTask.id);
});

test('hierarchical formatting renders parent and indented subtasks', () => {
  const tasks = [
    { id: 1, title: 'Root Task 1', status: 'queued', tier: 'organism', assigned_agent_id: '@lead', target_path: 'src/a.ts', parent_id: null },
    { id: 2, title: 'Child Task 1', status: 'in_progress', tier: 'molecule', assigned_agent_id: '@worker', target_path: 'src/b.ts', parent_id: 1 },
    { id: 3, title: 'Grandchild Task 1', status: 'queued', tier: 'atom', assigned_agent_id: '@worker', target_path: 'src/c.ts', parent_id: 2 },
    { id: 4, title: 'Root Task 2', status: 'done', tier: 'organism', assigned_agent_id: '@lead', target_path: null, parent_id: null }
  ];

  const card = formatTaskListCard(tasks);
  assert.ok(card.includes('#1 [queued] (@lead) [src/a.ts]: Root Task 1'));
  assert.ok(card.includes('  └── #2 [in_progress] (@worker) [src/b.ts]: Child Task 1'));
  assert.ok(card.includes('    └── #3 [queued] (@worker) [src/c.ts]: Grandchild Task 1'));
  assert.ok(card.includes('#4 [done] (@lead): Root Task 2'));
});

test('handleChemxTeamTask creates subtask and formats card with hierarchy in isolated db', async () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-subtask-test-'));
  try {
    openIndexDb(tmpCwd);
    const root = await handleChemxTeamTask({ action: 'create', title: 'MCP Parent Task' }, tmpCwd);
    assert.ok(root.id);

    const sub = await handleChemxTeamTask({ action: 'create', title: 'MCP Child Task', parentId: root.id }, tmpCwd);
    assert.ok(sub.id);
    assert.strictEqual(sub.parent_id, root.id);

    const listRes = await handleChemxTeamTask({ action: 'list' }, tmpCwd);
    assert.strictEqual(listRes.total, 2);
    assert.ok(listRes.card);
    assert.ok(listRes.card.includes('└──'));
    assert.ok(listRes.card.includes('MCP Child Task'));
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});
