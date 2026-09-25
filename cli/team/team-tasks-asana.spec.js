import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { openIndexDb } from '../search-db.js';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { runTeamCli } from './team-commands.js';
import { executeMcpTool } from '../mcp/tools.js';

test('team-cli: show and comment track Asana-style status updates and activity timeline', () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-show-'));
  try {
    const db = openIndexDb(tmpCwd);
    initTeamSchema(db);
    const created = createTask(db, { title: 'Asana Telemetry Task', tier: 'molecule' });

    // Post a status update comment
    const postRes = runTeamCli(['task', 'comment', String(created.id), 'Status Update: [On Track] Verified streaming unzipper'], false, tmpCwd);
    assert.strictEqual(postRes.task_id, created.id);

    // View task via show
    const showRes = runTeamCli(['task', 'show', String(created.id)], false, tmpCwd);
    assert.strictEqual(showRes.task.id, created.id);
    assert.strictEqual(showRes.events.length, 1);
    assert.strictEqual(showRes.events[0].message, 'Status Update: [On Track] Verified streaming unzipper');
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});

test('mcp-tools: chemx_team_task supports action show and comment', async () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-show-'));
  try {
    const db = openIndexDb(tmpCwd);
    initTeamSchema(db);
    const created = createTask(db, { title: 'MCP Task Telemetry' });

    // Comment via MCP
    const commentRes = await executeMcpTool('chemx_team_task', {
      action: 'comment',
      taskId: created.id,
      message: 'Status Update: In code review'
    }, tmpCwd);
    assert.strictEqual(commentRes.task_id, created.id);

    // Show via MCP
    const showRes = await executeMcpTool('chemx_team_task', {
      action: 'show',
      taskId: created.id
    }, tmpCwd);
    assert.strictEqual(showRes.task.id, created.id);
    assert.strictEqual(showRes.activityCount, 1);
    assert.ok(showRes.card.includes('In code review'));
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});
