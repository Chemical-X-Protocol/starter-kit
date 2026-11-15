import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { scanAttentionItems, confirmAttentionItem } from './ui-attention.js';

const blockedDb = () => {
  const db = new DatabaseSync(':memory:'); initTeamSchema(db);
  db.prepare("INSERT INTO agent_tasks (title, status, blocked_reason, assigned_agent_id, created_at, updated_at) VALUES ('stuck', 'blocked', 'waits on owner', '@chemist', 1, 5)").run();
  return db;
};

test('ui-attention: a blocked task carries id, assignee, reason and its update time', () => {
  const [item] = scanAttentionItems(blockedDb()).items;
  assert.deepEqual([item.taskId, item.assignee, item.reason, item.timestamp, item.status], [1, '@chemist', 'waits on owner', 5, 'blocked']);
});

test('ui-attention: requeue puts the task back in the queue and clears the reason; cancel cancels', () => {
  const db = blockedDb();
  confirmAttentionItem(db, 'task-1', 'requeue');
  assert.deepEqual({ ...db.prepare('SELECT status, blocked_reason FROM agent_tasks WHERE id = 1').get() }, { status: 'queued', blocked_reason: '' });
  confirmAttentionItem(db, 'task-1', 'cancel');
  assert.equal(db.prepare('SELECT status FROM agent_tasks WHERE id = 1').get().status, 'cancelled');
});
