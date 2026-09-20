import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer } from './ui-server.js';

const REQUIRED_HTML_MARKERS = [
  'vb-postbit',
  'Forum & Timeline',
  'kanban-col',
  'Tasks & Kanban',
  'filetree-container',
  'AST Codebase',
  'workbenchScopes',
  'Prompt Workbench',
  'pma-sidebar',
  'pma-table',
  'Database Studio'
];

test('E2E: GET / delivers full HTML shell with all core modules', async () => {
  const running = await startUiServer({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${running.port}/`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'));

    const html = await res.text();
    for (const marker of REQUIRED_HTML_MARKERS) {
      assert.ok(html.includes(marker), `HTML should contain marker: ${marker}`);
    }
  } finally {
    running.server.close();
  }
});

test('E2E: GET /api/status, /api/feed, /api/tasks return valid data structures', async () => {
  const running = await startUiServer({ port: 0 });
  try {
    const base = `http://localhost:${running.port}`;
    const resStatus = await fetch(`${base}/api/status`);
    assert.strictEqual(resStatus.status, 200);
    const statusData = await resStatus.json();
    assert.strictEqual(statusData.success, true);
    assert.ok(Array.isArray(statusData.agents));
    assert.ok(Array.isArray(statusData.tasks));
    assert.ok(Array.isArray(statusData.leases));
    assert.ok(Array.isArray(statusData.waitingLocks));
    assert.ok(typeof statusData.telemetry === 'object');
    assert.ok(typeof statusData.savings === 'object');

    const resFeed = await fetch(`${base}/api/feed`);
    assert.strictEqual(resFeed.status, 200);
    const feedData = await resFeed.json();
    assert.strictEqual(feedData.success, true);
    assert.ok(Array.isArray(feedData.feed));

    const resTasks = await fetch(`${base}/api/tasks`);
    assert.strictEqual(resTasks.status, 200);
    const tasksData = await resTasks.json();
    assert.strictEqual(tasksData.success, true);
    assert.ok(Array.isArray(tasksData.tasks));
  } finally {
    running.server.close();
  }
});

test('E2E: POST /api/tasks and POST /api/feed persist records to index database', async () => {
  const running = await startUiServer({ port: 0 });
  try {
    const base = `http://localhost:${running.port}`;
    const taskTitle = `E2E Verify Task ${Date.now()}`;
    const resTask = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskTitle, tier: 'atom', priority: 1 })
    });
    assert.strictEqual(resTask.status, 200);
    const taskData = await resTask.json();
    assert.strictEqual(taskData.success, true);
    assert.strictEqual(taskData.task.title, taskTitle);

    const checkTasks = await fetch(`${base}/api/tasks`);
    const allTasks = await checkTasks.json();
    const isTaskPersisted = allTasks.tasks.some((t) => t.title === taskTitle);
    assert.ok(isTaskPersisted, 'Created task must persist in database');

    const feedMsg = `E2E Feed Event ${Date.now()}`;
    const resFeed = await fetch(`${base}/api/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: '@worker_m6', message: feedMsg, channel: 'general' })
    });
    assert.strictEqual(resFeed.status, 200);
    const feedData = await resFeed.json();
    assert.strictEqual(feedData.success, true);
    assert.ok(feedData.post && feedData.post.id);

    const checkFeed = await fetch(`${base}/api/feed?since_id=${feedData.post.id - 1}`);
    const allFeed = await checkFeed.json();
    const isFeedPersisted = allFeed.feed.some((f) => f.id === feedData.post.id && f.message === feedMsg);
    assert.ok(isFeedPersisted, 'Created feed event must persist in database');
  } finally {
    running.server.close();
  }
});

test('E2E: GET /api/codebase/tree and /api/codebase/file inspect AST and connections', async () => {
  const running = await startUiServer({ port: 0 });
  try {
    const base = `http://localhost:${running.port}`;
    const resTree = await fetch(`${base}/api/codebase/tree`);
    assert.strictEqual(resTree.status, 200);
    const treeData = await resTree.json();
    assert.strictEqual(treeData.success, true);
    assert.ok(Array.isArray(treeData.tree));
    assert.ok(Array.isArray(treeData.files));

    const samplePath = treeData.files[0]?.path || 'src/ui/atoms/a-button/a-button.vue';
    const resFile = await fetch(`${base}/api/codebase/file?path=${encodeURIComponent(samplePath)}`);
    assert.strictEqual(resFile.status, 200);
    const fileData = await resFile.json();
    assert.strictEqual(fileData.success, true);
    assert.ok(fileData.file);
    assert.ok(Array.isArray(fileData.symbols));
    assert.ok(Array.isArray(fileData.connections));
  } finally {
    running.server.close();
  }
});

test('E2E: GET /api/db/tables, /api/db/browse, and POST /api/prompts/generate respond cleanly', async () => {
  const running = await startUiServer({ port: 0 });
  try {
    const base = `http://localhost:${running.port}`;
    const resTables = await fetch(`${base}/api/db/tables`);
    assert.strictEqual(resTables.status, 200);
    const tablesData = await resTables.json();
    assert.strictEqual(tablesData.success, true);
    assert.ok(tablesData.totalTables >= 12, 'Expected at least 12 database tables');
    assert.strictEqual(tablesData.tables.length, tablesData.totalTables);
    assert.ok(tablesData.tables.some((t) => t.name === 'agent_tasks'));
    assert.ok(tablesData.tables.some((t) => t.name === 'agent_feed'));

    const resBrowse = await fetch(`${base}/api/db/browse?table=agent_tasks&page=1&pageSize=5`);
    assert.strictEqual(resBrowse.status, 200);
    const browseData = await resBrowse.json();
    assert.strictEqual(browseData.success, true);
    assert.strictEqual(browseData.table, 'agent_tasks');
    assert.ok(Array.isArray(browseData.rows));
    assert.ok(browseData.totalRows >= 1);

    const resPrompt = await fetch(`${base}/api/prompts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'grade-f',
        report: {
          violations: [{ severity: 'CRITICAL', rule: 'NO_RAW_DOM', hazard: 'Raw DOM', directive: 'Use atom', filePath: 'src/Card.vue', line: 10, isAiSlop: false }],
          hotspots: [{ filePath: 'src/Card.vue', lineCount: 200, violationCount: 1, isMonolith: false }]
        }
      })
    });
    assert.strictEqual(resPrompt.status, 200);
    const promptData = await resPrompt.json();
    assert.strictEqual(promptData.success, true);
    assert.ok(promptData.prompt.length > 0);
    assert.ok(promptData.estimatedTokens > 0);
  } finally {
    running.server.close();
  }
});

test('Molecular Compliance: all cli/ui-*.js non-spec files strictly under 100 lines', () => {
  const cliDir = path.resolve(process.cwd(), 'cli');
  const files = fs.readdirSync(cliDir);
  const isUiFile = (f) => (f.startsWith('ui-') || f === 'ui.js') && f.endsWith('.js') && !f.endsWith('.spec.js');
  const uiFiles = files.filter(isUiFile);

  assert.ok(uiFiles.length >= 10, 'Expected at least 10 UI implementation files');
  for (const file of uiFiles) {
    const fullPath = path.join(cliDir, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n').length;
    assert.ok(lines <= 100, `File ${file} exceeds 100 lines: ${lines} lines`);
  }
});
