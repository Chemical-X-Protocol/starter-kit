import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, listTasks, updateTaskStatus } from './team-db-tasks.js';
import { buildTaskListQuery } from './team-db-task-helpers.js';
import { formatTaskListCard } from './team-format.js';
import { handleChemxTeamTask } from '../mcp/tools-team.js';
import { openIndexDb } from '../search-db.js';
import { autoGenerateTasksFromAudit, reconcileAuditTasks } from './team-triage.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
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
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      pillar TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL DEFAULT '',
      directive TEXT NOT NULL DEFAULT ''
    );
  `);
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

test('listTasks: filters by rule and priority', () => {
  const db = setupDb();
  createTask(db, { title: 'Security Task', rule_id: 'SECURITY_RAW_HTML_INJECTION', priority: 1 });
  createTask(db, { title: 'Control Flow Task', rule_id: 'CONTROL_FLOW_INLINE_BOOLEAN', priority: 2 });
  createTask(db, { title: 'Typography Task', rule_id: 'TYPOGRAPHY_EM_DASH', priority: 3 });

  const secTasks = listTasks(db, { rule: 'SECURITY' });
  assert.strictEqual(secTasks.length, 1);
  assert.strictEqual(secTasks[0].rule_id, 'SECURITY_RAW_HTML_INJECTION');

  const prio1Tasks = listTasks(db, { priority: 1 });
  assert.strictEqual(prio1Tasks.length, 1);
  assert.strictEqual(prio1Tasks[0].title, 'Security Task');

  const prio2Tasks = listTasks(db, { priority: 2 });
  assert.strictEqual(prio2Tasks.length, 1);
  assert.strictEqual(prio2Tasks[0].title, 'Control Flow Task');
});

test('autoGenerateTasksFromAudit: groups multi-file violations into parent task and child subtasks', () => {
  const db = setupDb();
  db.prepare(`
    INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count)
    VALUES 
      ('app/views/ViewA.vue', 1000, 2000, 'view', 80, 3000, 75, 1),
      ('app/views/ViewB.vue', 1000, 2000, 'view', 90, 3500, 70, 1)
  `).run();

  db.prepare(`
    INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
    VALUES 
      ('app/views/ViewA.vue', 'SECURITY_RAW_HTML_INJECTION', 'CRITICAL', 'security', 57, 'Unsanitized HTML injection via v-html', 'Sanitize dynamic HTML via DOMPurify'),
      ('app/views/ViewB.vue', 'SECURITY_RAW_HTML_INJECTION', 'CRITICAL', 'security', 92, 'Unsanitized HTML injection via v-html', 'Sanitize dynamic HTML via DOMPurify')
  `).run();

  const generated = autoGenerateTasksFromAudit(db);
  assert.strictEqual(generated.length, 3);

  const parent = generated.find((t) => t.parent_id === null);
  assert.ok(parent);
  assert.strictEqual(parent.rule_id, 'SECURITY_RAW_HTML_INJECTION');
  assert.ok(parent.title.includes('[SECURITY_RAW_HTML_INJECTION]'));
  assert.ok(parent.title.includes('2 files'));

  const children = generated.filter((t) => t.parent_id === parent.id);
  assert.strictEqual(children.length, 2);
  const paths = children.map((c) => c.target_path);
  assert.ok(paths.includes('app/views/ViewA.vue'));
  assert.ok(paths.includes('app/views/ViewB.vue'));

  const childA = children.find((c) => c.target_path === 'app/views/ViewA.vue');
  assert.ok(childA.description.includes('Lines: 57'));
  assert.ok(childA.description.includes('Sanitize dynamic HTML via DOMPurify'));
});

test('reconcileAuditTasks: auto-completes parent task when all child subtasks are done', () => {
  const db = setupDb();
  const parent = createTask(db, { title: 'Parent Rule Epic', origin_type: 'audit', rule_id: 'TEST_RULE' });
  const child1 = createTask(db, { title: 'Child 1', parent_id: parent.id, target_path: 'src/clean1.ts', origin_type: 'audit' });
  const child2 = createTask(db, { title: 'Child 2', parent_id: parent.id, target_path: 'src/clean2.ts', origin_type: 'audit' });

  const resolved = reconcileAuditTasks(db);
  assert.ok(resolved.some((r) => r.id === child1.id));
  assert.ok(resolved.some((r) => r.id === child2.id));
  assert.ok(resolved.some((r) => r.id === parent.id));

  const parentRow = db.prepare('SELECT status, result_payload FROM agent_tasks WHERE id = ?').get(parent.id);
  assert.strictEqual(parentRow.status, 'done');
  const payload = JSON.parse(parentRow.result_payload);
  assert.strictEqual(payload.autoCompleted, true);
});
