import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openIndexDb } from '../search-db.js';
import { createTask } from './team-db-tasks.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';

const LONG_TITLE = 'Decompose inline multi-clause boolean comparison in if statement per Directive 3.A in a deeply nested module';

const seedProject = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-view-'));
  const db = openIndexDb(cwd);
  const seed = (count, status) => {
    for (let i = 0; i < count; i++) {
      createTask(db, { title: `${LONG_TITLE} ${status} ${i}`, status, target_path: `cli/audit/some-long-module-name-${i}.js` });
    }
  };
  seed(10, 'done');
  seed(30, 'queued');
  seed(5, 'in_progress');
  return cwd;
};

const withProject = async (fn) => {
  const cwd = seedProject();
  try {
    await fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

const STATUS_COL = (view) => view.cols.indexOf('status');

test('task list view: default shows open tasks only, newest first, capped at 20', async () => {
  await withProject(async (cwd) => {
    const view = await handleChemxTeamTask({ action: 'list' }, cwd);
    assert.strictEqual(view.rows.length, 20);
    assert.strictEqual(view.total, 35);
    assert.strictEqual(view.rows[0][view.cols.indexOf('id')], 45);
    const statuses = new Set(view.rows.map((r) => r[STATUS_COL(view)]));
    assert.strictEqual(statuses.has('done'), false);
  });
});

test('task list view: default payload stays under 2000 bytes (about 500 tokens)', async () => {
  await withProject(async (cwd) => {
    const mcpView = await handleChemxTeamTask({ action: 'list' }, cwd);
    assert.ok(JSON.stringify(mcpView).length < 2000, `mcp payload ${JSON.stringify(mcpView).length} bytes`);
    const cliView = runTeamCli(['task', 'list', '--json'], false, cwd);
    assert.ok(JSON.stringify(cliView).length < 2000, `cli payload ${JSON.stringify(cliView).length} bytes`);
  });
});

test('task list view: --all returns every task', async () => {
  await withProject(async (cwd) => {
    const cliView = runTeamCli(['task', 'list', '--json', '--all'], false, cwd);
    assert.strictEqual(cliView.rows.length, 45);
    const mcpView = await handleChemxTeamTask({ action: 'list', all: true }, cwd);
    assert.strictEqual(mcpView.rows.length, 45);
  });
});

test('task list view: status filter and limit recover the rest', async () => {
  await withProject(async (cwd) => {
    const done = runTeamCli(['task', 'list', '--json', '--status=done'], false, cwd);
    assert.strictEqual(done.total, 10);
    assert.ok(done.rows.every((r) => r[STATUS_COL(done)] === 'done'));
    const limited = await handleChemxTeamTask({ action: 'list', limit: 5 }, cwd);
    assert.strictEqual(limited.rows.length, 5);
    assert.strictEqual(limited.total, 35);
  });
});
