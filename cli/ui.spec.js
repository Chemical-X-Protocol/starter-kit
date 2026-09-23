import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import { openIndexDb } from './search-db.js';
import { handleSwarmStatus, handlePostFeed, getAggregatedTelemetry } from './ui-handlers.js';
import { generateSwarmHtml } from './ui-html.js';
import { createUiServer, startUiServer } from './ui-server.js';

test('ui-handlers: queries genuine SQLite index.db data and aggregates telemetry', () => {
  const db = openIndexDb(process.cwd());
  assert.ok(db, 'SQLite index.db must be available');

  const telemetry = getAggregatedTelemetry(db);
  assert.ok(typeof telemetry.promptTokens === 'number');
  assert.ok(typeof telemetry.completionTokens === 'number');
  assert.ok(typeof telemetry.totalTokens === 'number');
  assert.ok(typeof telemetry.totalCost === 'number');

  const status = handleSwarmStatus(db);
  assert.strictEqual(status.success, true);
  assert.ok(Array.isArray(status.agents));
  assert.ok(Array.isArray(status.posts));
  assert.ok(Array.isArray(status.leases));
  assert.ok(Array.isArray(status.tasks));
  assert.ok(typeof status.waitingLocksCount === 'number');
  assert.ok(status.summary);
});

test('ui-handlers: posts feed events and updates timeline in SQLite', () => {
  const db = openIndexDb(process.cwd());
  const testMessage = `Automated UI test event ${Date.now()}`;
  const result = handlePostFeed(db, {
    author: '@ui-specialist',
    message: testMessage,
    channel: 'general',
    eventType: 'broadcast'
  });

  assert.ok(result);
  const status = handleSwarmStatus(db);
  const found = status.posts.some((p) => p.message === testMessage);
  assert.strictEqual(found, true, 'Posted event must appear in SQLite feed query');
});

test('ui-html: generates standalone HTML bundle with Starship dark theme and hydrated state', () => {
  const sampleState = {
    agents: [{ id: '1', name: 'UI Bot', role: 'specialist', status: 'busy' }],
    posts: [{ id: 1, author: 'UI Bot', eventType: 'broadcast', message: 'Hello' }],
    leases: [],
    tasks: [],
    telemetry: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, totalCost: 0.0045 }
  };

  const html = generateSwarmHtml(sampleState);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Chemical X: Swarm Control'));
  assert.ok(html.includes('__CHEMX_HYDRATED_STATE__'));
  assert.ok(html.includes('UI Bot'));
  assert.ok(html.includes('Vue'));
  assert.ok(html.includes('xo-glass') || html.includes('xo-orb'));
});

test('ui-server: creates HTTP server and handles GET / and API routes', async () => {
  const { server } = createUiServer(process.cwd());
  assert.ok(server instanceof http.Server);

  const running = await startUiServer({ port: 0, cwd: process.cwd() });
  assert.ok(running.port > 0);
  let taskJson = null;

  try {
    const resHtml = await fetch(`http://localhost:${running.port}/`);
    assert.strictEqual(resHtml.status, 200);
    const htmlText = await resHtml.text();
    assert.ok(htmlText.includes('Chemical X: Swarm Control'));

    const resApi = await fetch(`http://localhost:${running.port}/api/swarm/status`);
    const resFav = await fetch(`http://localhost:${running.port}/favicon.ico`);
    assert.strictEqual(resFav.status, 204);

    assert.strictEqual(resApi.status, 200);
    const apiJson = await resApi.json();
    assert.strictEqual(apiJson.success, true);
    assert.ok(Array.isArray(apiJson.agents));
    assert.ok(apiJson.savings, 'Status must include savings metrics');
    assert.ok(typeof apiJson.savings.tokensSaved === 'number');
    assert.ok(typeof apiJson.savings.dollarsSaved === 'number');

    const resCodebase = await fetch(`http://localhost:${running.port}/api/swarm/codebase`);
    assert.strictEqual(resCodebase.status, 200);
    const codebaseJson = await resCodebase.json();
    assert.strictEqual(codebaseJson.success, true);
    assert.ok(Array.isArray(codebaseJson.files));
    assert.ok(codebaseJson.files.length > 0);

    const testTaskTitle = `API Test Task ${Date.now()}`;
    const resCreateTask = await fetch(`http://localhost:${running.port}/api/swarm/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: testTaskTitle, tier: 'atom', priority: 1 })
    });
    assert.strictEqual(resCreateTask.status, 200);
    taskJson = await resCreateTask.json();
    assert.strictEqual(taskJson.success, true);
    assert.ok(taskJson.task?.id);

    const resClaim = await fetch(`http://localhost:${running.port}/api/swarm/tasks/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskJson.task.id, agentId: '@api-tester' })
    });
    assert.strictEqual(resClaim.status, 200);
    const claimJson = await resClaim.json();
    assert.strictEqual(claimJson.success, true);

    const testLockFile = `src/api-lock-test-${Date.now()}.ts`;
    const resAcquire = await fetch(`http://localhost:${running.port}/api/swarm/locks/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: testLockFile, agentId: '@api-tester', purpose: 'test' })
    });
    assert.strictEqual(resAcquire.status, 200);
    const acquireJson = await resAcquire.json();
    assert.strictEqual(acquireJson.success, true);

    const resRelease = await fetch(`http://localhost:${running.port}/api/swarm/locks/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: testLockFile, agentId: '@api-tester' })
    });
    assert.strictEqual(resRelease.status, 200);
    const releaseJson = await resRelease.json();
    assert.strictEqual(releaseJson.success, true);

    const resSettings = await fetch(`http://localhost:${running.port}/api/swarm/settings/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'heartbeat' })
    });
    assert.strictEqual(resSettings.status, 200);
    const settingsJson = await resSettings.json();
    assert.strictEqual(settingsJson.success, true);

    const resVacuum = await fetch(`http://localhost:${running.port}/api/swarm/settings/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vacuum' })
    });
    assert.strictEqual((await resVacuum.json()).success, true);

    const resTimeout = await fetch(`http://localhost:${running.port}/api/swarm/settings/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'busy_timeout', timeoutMs: 3000 })
    });
    assert.strictEqual((await resTimeout.json()).success, true);

    const resFeed = await fetch(`http://localhost:${running.port}/api/swarm/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Live Feed Spec Test', author: '@spec-tester' })
    });
    assert.strictEqual((await resFeed.json()).success, true);

    const resDone = await fetch(`http://localhost:${running.port}/api/swarm/tasks/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskJson.task.id })
    });
    assert.strictEqual((await resDone.json()).success, true);

    const resDbMetrics = await fetch(`http://localhost:${running.port}/api/swarm/database/metrics`);
    assert.strictEqual(resDbMetrics.status, 200);
    const dbMetricsJson = await resDbMetrics.json();
    assert.strictEqual(dbMetricsJson.success, true);
    assert.ok(dbMetricsJson.pageSize > 0);
    assert.ok(Array.isArray(dbMetricsJson.tables));

    const resDbQuery = await fetch(`http://localhost:${running.port}/api/swarm/database/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "SELECT name, type FROM sqlite_master WHERE type = 'table' LIMIT 5" })
    });
    assert.strictEqual(resDbQuery.status, 200);
    const dbQueryJson = await resDbQuery.json();
    assert.strictEqual(dbQueryJson.success, true);
    assert.ok(dbQueryJson.rows.length > 0);
    assert.ok(typeof dbQueryJson.durationMs === 'number');

    const resAttention = await fetch(`http://localhost:${running.port}/api/swarm/attention`);
    assert.strictEqual(resAttention.status, 200);
    const attentionJson = await resAttention.json();
    assert.strictEqual(attentionJson.success, true);
    assert.ok(Array.isArray(attentionJson.items));

    const resAttentionAction = await fetch(`http://localhost:${running.port}/api/swarm/attention/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: 'task-test', action: 'approve' })
    });
    assert.strictEqual(resAttentionAction.status, 200);
    const attentionActionJson = await resAttentionAction.json();
    assert.strictEqual(attentionActionJson.success, true);

    assert.ok(htmlText.includes('☰'), 'HTML must include hamburger button');
    assert.ok(htmlText.includes('Tasks & Kanban') || htmlText.includes('TASKS'), 'HTML must include tasks link');
    assert.ok(htmlText.includes('File Locks Hub') || htmlText.includes('LOCKS'), 'HTML must include locks link');
    assert.ok(htmlText.includes('AST Codebase') || htmlText.includes('CODEBASE'), 'HTML must include codebase link');
    assert.ok(htmlText.includes('Attention Inbox'), 'HTML must include Attention Inbox link');
    assert.ok(htmlText.includes('Database Studio'), 'HTML must include Database Studio link');
    assert.ok(htmlText.includes('cert'), 'HTML must include canvas certificate');
    assert.ok(htmlText.includes('Download PNG') || htmlText.includes('downloadPng'), 'HTML must include download PNG button');
  } finally {
    if (taskJson?.task?.id) {
      const db = openIndexDb(process.cwd());
      db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(taskJson.task.id);
    }
    running.server.close();
  }
});

test('molecular architecture: all files in src/ui are strictly under 100 lines (Directive 1.A)', () => {
  const uiDir = path.resolve(process.cwd(), 'src/ui');
  const EXCLUDED_EXTS = new Set(['.html']);
  const getAllFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results = results.concat(getAllFiles(full));
      } else if (!EXCLUDED_EXTS.has(path.extname(file))) {
        results.push(full);
      }
    }
    return results;
  };

  const files = getAllFiles(uiDir);
  assert.ok(files.length >= 15, `Expected at least 15 UI files, found ${files.length}`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    const rel = path.relative(process.cwd(), file);
    assert.ok(lines < 100, `File ${rel} exceeds 100 lines (actual: ${lines})`);
  }
});


test('molecular architecture: molecules and organisms templates have ZERO raw DOM (Directive 1.G)', () => {
  const uiDir = path.resolve(process.cwd(), 'src/ui');
  const getAllVueFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results = results.concat(getAllVueFiles(full));
      } else if (file.endsWith('.vue')) {
        results.push(full);
      }
    }
    return results;
  };

  const vueFiles = getAllVueFiles(uiDir).filter((f) => (
    f.includes('/molecules/') || f.includes('/organisms/')
  ));

  const rawDomTagRegex = /<(div|span|button|p|h1|h2|h3|h4|input|textarea|select|a)\b/i;

  for (const file of vueFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const match = content.match(/<template>([\s\S]*?)<\/template>/);
    assert.ok(match, `Missing template in ${file}`);
    const templateContent = match[1];
    const tagMatch = templateContent.match(rawDomTagRegex);
    const rel = path.relative(process.cwd(), file);
    assert.strictEqual(tagMatch, null, `Forbidden raw DOM element <${tagMatch ? tagMatch[1] : ''}> found in ${rel}`);
  }
});

test('molecular architecture: all views in src/ui/views/ are strictly 10 to 20 lines (Directive 1.B)', () => {
  const viewsDir = path.resolve(process.cwd(), 'src/ui/views');
  const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.vue'));
  assert.ok(viewFiles.length >= 5, `Expected at least 5 view files, found ${viewFiles.length}`);
  for (const file of viewFiles) {
    const viewPath = path.join(viewsDir, file);
    const content = fs.readFileSync(viewPath, 'utf-8');
    const lines = content.trim().split('\n').length;
    assert.ok(lines >= 10 && lines <= 20, `${file} must be 10-20 lines (actual: ${lines})`);
  }
});

test('molecular architecture: zero setInterval in business and component logic (Directive 6.A)', () => {
  const uiDir = path.resolve(process.cwd(), 'src/ui');
  const tsFiles = fs.readdirSync(path.join(uiDir, 'composables')).filter((f) => f.endsWith('.ts'));
  for (const f of tsFiles) {
    const content = fs.readFileSync(path.join(uiDir, 'composables', f), 'utf-8');
    assert.strictEqual(
      content.includes('setInterval'),
      false,
      `Forbidden setInterval found in composable ${f}`
    );
  }
});
