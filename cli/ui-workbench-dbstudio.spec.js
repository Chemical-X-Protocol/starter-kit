import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import {
  handleGeneratePrompt,
  handleDbTables,
  handleDbBrowse,
  handleDbStructure,
  handleDbQuery
} from './ui-actions-studio.js';
import { routeGet, routePost } from './ui-server-routes.js';
import { startUiServer } from './ui-server.js';
import { VIEW_WORKBENCH_TEMPLATE } from './ui-template-workbench.js';
import { VIEW_DBSTUDIO_TEMPLATE } from './ui-template-dbstudio.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  const astTables = ['files', 'symbols', 'props', 'hooks', 'imports', 'violations', 'audit_snapshots'];
  astTables.forEach((t) => {
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY, path TEXT, name TEXT);`);
  });
  initTeamSchema(db);
  const now = Date.now();
  db.prepare("INSERT INTO agent_tasks (title, tier, status, created_at, updated_at) VALUES ('Studio Task 1', 'backend', 'todo', ?, ?)").run(now, now);
  db.prepare("INSERT INTO agent_tasks (title, tier, status, created_at, updated_at) VALUES ('Studio Task 2', 'organism', 'in_progress', ?, ?)").run(now, now);
  return db;
};

const mockReport = {
  violations: [
    { severity: 'CRITICAL', rule: 'NO_RAW_DOM', hazard: 'Raw DOM', directive: 'Use atom', filePath: 'src/App.vue', line: 10, isAiSlop: false },
    { severity: 'HIGH', rule: 'HOOK_SATURATION', hazard: 'Too many hooks', directive: 'Extract composable', filePath: 'src/Hook.ts', line: 5, isAiSlop: false },
    { severity: 'MEDIUM', rule: 'RAW_INLINE_STYLE', hazard: 'Inline style', directive: 'Use mixin', filePath: 'src/Card.vue', line: 12, isAiSlop: false },
    { severity: 'LOW', rule: 'EM_DASH_HYGIENE', hazard: 'Em dash used', directive: 'Use hyphen', filePath: 'src/Doc.vue', line: 1, isAiSlop: false },
    { severity: 'HIGH', rule: 'AI_SLOP_CONVERSATIONAL', hazard: 'Conversational residue', directive: 'Remove', filePath: 'src/Slop.ts', line: 1, isAiSlop: true }
  ],
  hotspots: [{ filePath: 'src/Monolith.vue', lineCount: 2500, violationCount: 10, isMonolith: true }]
};

test('Prompt Workbench: handleGeneratePrompt builds valid prompts with tokens across all scopes', () => {
  const scopes = ['master', 'grade-f', 'grade-d', 'grade-c', 'grade-b', 'ai-slop', 'hotspots'];
  for (const scope of scopes) {
    const res = handleGeneratePrompt(null, { report: mockReport, scope });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.scope, scope);
    assert.ok(res.prompt.length > 20, `Scope ${scope} should generate non-empty prompt`);
    assert.ok(res.estimatedTokens > 0, `Scope ${scope} should estimate tokens`);
    assert.strictEqual(res.charCount, res.prompt.length);
  }

  const defaultRes = handleGeneratePrompt(null, { report: mockReport, scope: 'unknown-scope' });
  assert.strictEqual(defaultRes.success, true);
  assert.ok(defaultRes.prompt.includes('Chemical X'));
});

test('Database Studio: handleDbTables discovers all tables with live counts', () => {
  const db = setupTestDb();
  const res = handleDbTables(db);
  assert.strictEqual(res.success, true);
  assert.ok(res.totalTables >= 12);
  assert.ok(res.tables.length >= 12);

  const taskTable = res.tables.find((t) => t.name === 'agent_tasks');
  assert.ok(taskTable);
  assert.strictEqual(taskTable.rowCount, 2);
});

test('Database Studio: handleDbBrowse supports paginated queries and rejects invalid tables', () => {
  const db = setupTestDb();
  const res = handleDbBrowse(db, { table: 'agent_tasks', page: '1', pageSize: '1' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.table, 'agent_tasks');
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(res.totalRows, 2);
  assert.strictEqual(res.totalPages, 2);
  assert.ok(res.columns.includes('title'));

  const invalid = handleDbBrowse(db, { table: 'drop_database' });
  assert.strictEqual(invalid.success, false);
  assert.ok(invalid.error.includes('Invalid table'));
});

test('Database Studio: handleDbStructure retrieves column and index metadata', () => {
  const db = setupTestDb();
  const res = handleDbStructure(db, { table: 'agent_tasks' });
  assert.strictEqual(res.success, true);
  assert.ok(res.columns.some((c) => c.name === 'title'));
  assert.ok(res.columns.some((c) => c.name === 'status'));
  assert.ok(Array.isArray(res.indexes));
});

test('Database Studio: handleDbQuery enforces read-only safety for custom SQL', () => {
  const db = setupTestDb();
  const okRes = handleDbQuery(db, { query: 'SELECT COUNT(*) as cnt FROM agent_tasks' });
  assert.strictEqual(okRes.success, true);
  assert.strictEqual(okRes.rowCount, 1);
  assert.strictEqual(okRes.rows[0].cnt, 2);
  assert.ok(okRes.durationMs >= 0);

  const blockedRes = handleDbQuery(db, { query: 'DELETE FROM agent_tasks' });
  assert.strictEqual(blockedRes.success, false);
  assert.ok(blockedRes.error.includes('Only SELECT'));
});

test('Routes: routeGet and routePost resolve Studio endpoints', () => {
  const db = setupTestDb();
  const tables = routeGet('/api/db/tables', db);
  assert.strictEqual(tables.success, true);
  assert.ok(tables.tables.length >= 12);

  const browse = routeGet('/api/db/browse?table=agent_tasks&page=1&pageSize=5', db);
  assert.strictEqual(browse.success, true);
  assert.strictEqual(browse.rows.length, 2);

  const struct = routeGet('/api/db/structure?table=agent_tasks', db);
  assert.strictEqual(struct.success, true);

  const genPrompt = routePost('/api/prompts/generate', db, { report: mockReport, scope: 'grade-f' });
  assert.strictEqual(genPrompt.success, true);
  assert.ok(genPrompt.prompt.includes('Grade F'));

  const sqlRes = routePost('/api/db/query', db, { query: 'SELECT 1 as num' });
  assert.strictEqual(sqlRes.success, true);
  assert.strictEqual(sqlRes.rows[0].num, 1);
});

test('HTTP Server: studio endpoints respond over HTTP', async () => {
  const running = await startUiServer({ port: 0, cwd: process.cwd() });
  try {
    const base = `http://localhost:${running.port}`;
    const resTables = await fetch(`${base}/api/db/tables`);
    assert.strictEqual(resTables.status, 200);
    const jsonTables = await resTables.json();
    assert.strictEqual(jsonTables.success, true);

    const resPrompt = await fetch(`${base}/api/prompts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'master' })
    });
    assert.strictEqual(resPrompt.status, 200);
    const jsonPrompt = await resPrompt.json();
    assert.strictEqual(jsonPrompt.success, true);
    assert.ok(jsonPrompt.prompt.length > 0);

    const resBrowse = await fetch(`${base}/api/db/browse?table=agent_tasks`);
    assert.strictEqual(resBrowse.status, 200);
    const jsonBrowse = await resBrowse.json();
    assert.strictEqual(jsonBrowse.success, true);

    const resSql = await fetch(`${base}/api/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT 42 as answer' })
    });
    assert.strictEqual(resSql.status, 200);
    const jsonSql = await resSql.json();
    assert.strictEqual(jsonSql.rows[0].answer, 42);
  } finally {
    running.server.close();
  }
});

test('Templates: Workbench and Database Studio templates export valid markup', () => {
  assert.ok(VIEW_WORKBENCH_TEMPLATE.includes('workbenchScopes'));
  assert.ok(VIEW_WORKBENCH_TEMPLATE.includes('workbenchTokens'));
  assert.ok(VIEW_WORKBENCH_TEMPLATE.includes('copyWorkbenchPrompt'));
  assert.ok(VIEW_DBSTUDIO_TEMPLATE.includes('pma-sidebar'));
  assert.ok(VIEW_DBSTUDIO_TEMPLATE.includes('pma-table'));
  assert.ok(VIEW_DBSTUDIO_TEMPLATE.includes('pma-sql-console'));
});
