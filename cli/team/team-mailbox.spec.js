import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert';
import { openIndexDb } from '../search-db.js';
import { sendDirectMessage, getAgentMailbox, normalizeHandle } from './team-db-mailbox.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { requestFileLock } from './team-db-locks.js';
import { getAgent } from './team-db-agents.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeam } from '../mcp/tools-team.js';
import { executeMcpTool } from '../mcp/tools.js';

const withTmpCwd = async (fn) => {
  const orig = process.cwd();
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mbox-'));
  try {
    process.chdir(tmpCwd);
    const db = openIndexDb(tmpCwd);
    return await fn(db, tmpCwd);
  } finally {
    process.chdir(orig);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
};

test('normalizeHandle and sendDirectMessage validation', () => withTmpCwd((db) => {
  assert.strictEqual(normalizeHandle('alice'), '@alice');
  assert.strictEqual(normalizeHandle('@bob'), '@bob');
  assert.strictEqual(normalizeHandle(null), null);
  const dm = sendDirectMessage(db, {
    author_id: 'alice', recipient_id: 'bob', message: 'Hello',
    task_id: 1, thread_id: 2, metadata: { priority: 'high' }
  });
  assert.strictEqual(dm.author_id, '@alice');
  assert.strictEqual(dm.recipient_id, '@bob');
  assert.strictEqual(dm.event_type, 'dm');
  assert.strictEqual(dm.metadata.priority, 'high');
  assert.strictEqual(dm.read_at, null);
  assert.strictEqual(getAgent(db, '@alice').role, 'contributor');
  assert.throws(() => sendDirectMessage(db, { message: 'err' }), /recipient_id is required/);
}));

test('getAgentMailbox aggregates tasks, messages, leases and handles markRead', () => withTmpCwd((db) => {
  createTask(db, { title: 'T1', status: 'queued', assigned_agent_id: '@worker' });
  createTask(db, { title: 'T2', status: 'in_progress', assigned_agent_id: '@worker' });
  createTask(db, { title: 'T3', status: 'done', assigned_agent_id: '@worker' });
  requestFileLock(db, 'src/test.js', '@worker', { purpose: 'refactor' });
  sendDirectMessage(db, { author_id: '@lead', recipient_id: 'worker', message: 'Msg 1' });
  sendDirectMessage(db, { author_id: '@lead', recipient_id: '@worker', message: 'Msg 2' });

  const box = getAgentMailbox(db, 'worker');
  assert.strictEqual(box.unreadCount, 2);
  assert.strictEqual(box.tasks.rows.length, 2);
  assert.strictEqual(box.messages.rows.length, 2);
  assert.strictEqual(box.leases.rows.length, 1);
  assert.strictEqual(getAgentMailbox(db, '@worker', { markRead: true }).unreadCount, 2);
  assert.strictEqual(getAgentMailbox(db, '@worker').unreadCount, 0);
  assert.strictEqual(getAgentMailbox(db, '@worker', { since: box.messages.rows[0][0] }).messages.rows.length, 0);
}));

test('atomic CAS claimTask prevents duplicate claims', () => withTmpCwd((db) => {
  const task = createTask(db, { title: 'Atomic Task', status: 'queued' });
  const claim1 = claimTask(db, task.id, '@agentA');
  const claim2 = claimTask(db, task.id, '@agentB');
  assert.strictEqual(claim1.success, true);
  assert.strictEqual(claim1.task.status, 'in_progress');
  assert.strictEqual(claim2.success, false);
  assert.strictEqual(claim2.reason, 'already_claimed');
}));

test('MCP handleChemxTeam router and set-target bug fix', () => withTmpCwd(async (db, tmpCwd) => {
  const task = createTask(db, { title: 'Set Target Task', status: 'queued' });
  db.prepare('UPDATE agent_tasks SET target_path = ?, updated_at = ? WHERE id = ?').run('src/a.js', Date.now(), task.id);
  assert.strictEqual(db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id).target_path, 'src/a.js');

  const inboxRes = await handleChemxTeam({ subAction: 'inbox', agentId: '@agent' }, tmpCwd);
  const dmRes = await handleChemxTeam({ subAction: 'dm', recipientId: '@agent', message: 'Hi' }, tmpCwd);
  assert.ok(inboxRes.agentId && dmRes.id);
}));

test('CLI runTeamCli dispatches inbox and dm commands including --to flag', () => withTmpCwd((_db, tmpCwd) => {
  const inboxRes = runTeamCli(['inbox', '--agent=@agent', '--json'], false, tmpCwd);
  const dmRes = runTeamCli(['dm', '@agent', 'Hello from CLI', '--as=@sender', '--json'], false, tmpCwd);
  const dmToRes = runTeamCli(['dm', '--to=@agent', 'Hello via to flag', '--as=@sender', '--json'], false, tmpCwd);
  assert.ok(inboxRes?.agentId && dmRes?.recipient_id === '@agent' && dmToRes?.message === 'Hello via to flag');
}));

test('MCP chemx team inbox via executeMcpTool', () => withTmpCwd(async (_db, tmpCwd) => {
  const mcpRes = await executeMcpTool('chemx', { action: 'team', params: { subAction: 'inbox', agentId: '@agent', cwd: tmpCwd } });
  assert.strictEqual(mcpRes?.agentId, '@agent');
}));
