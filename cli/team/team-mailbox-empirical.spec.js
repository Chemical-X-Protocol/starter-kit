import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { sendDirectMessage, getAgentMailbox, normalizeHandle } from './team-db-mailbox.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { registerAgent, getAgent } from './team-db-agents.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('empirical: handle normalization (@agent vs agent)', () => {
  const db = setupDb();

  assert.strictEqual(normalizeHandle('alice'), '@alice');
  assert.strictEqual(normalizeHandle('@alice'), '@alice');
  assert.strictEqual(normalizeHandle(''), null);
  assert.strictEqual(normalizeHandle(null), null);
  assert.strictEqual(normalizeHandle(undefined), null);

  const dm1 = sendDirectMessage(db, {
    author_id: 'alice',
    recipient_id: 'bob',
    message: 'Message from un-prefixed handle'
  });
  assert.strictEqual(dm1.author_id, '@alice');
  assert.strictEqual(dm1.recipient_id, '@bob');

  const dm2 = sendDirectMessage(db, {
    author_id: '@charlie',
    recipient_id: '@david',
    message: 'Message from prefixed handle'
  });
  assert.strictEqual(dm2.author_id, '@charlie');
  assert.strictEqual(dm2.recipient_id, '@david');

  const dm3 = sendDirectMessage(db, {
    recipient_id: 'eve',
    message: 'Message without author'
  });
  assert.strictEqual(dm3.author_id, '@agent');
  assert.strictEqual(dm3.recipient_id, '@eve');

  assert.throws(() => sendDirectMessage(db, { author_id: 'alice', message: 'No recipient' }), {
    message: 'recipient_id is required'
  });

  const boxUnprefixed = getAgentMailbox(db, 'bob');
  const boxPrefixed = getAgentMailbox(db, '@bob');
  assert.strictEqual(boxUnprefixed.agentId, '@bob');
  assert.strictEqual(boxPrefixed.agentId, '@bob');
  assert.strictEqual(boxUnprefixed.unreadCount, 1);
  assert.strictEqual(boxPrefixed.unreadCount, 1);

  assert.strictEqual(getAgentMailbox(db, ''), null);
  assert.strictEqual(getAgentMailbox(db, null), null);
  assert.strictEqual(getAgentMailbox(db, undefined), null);
});

test('empirical: message filtering by recipient_id and markRead behavior', () => {
  const db = setupDb();

  sendDirectMessage(db, { author_id: 'alice', recipient_id: 'bob', message: 'Bob msg 1' });
  sendDirectMessage(db, { author_id: 'alice', recipient_id: 'bob', message: 'Bob msg 2' });
  sendDirectMessage(db, { author_id: 'bob', recipient_id: 'alice', message: 'Alice msg 1' });
  sendDirectMessage(db, { author_id: 'charlie', recipient_id: 'charlie', message: 'Charlie self note' });

  db.prepare(`
    INSERT INTO agent_feed (timestamp, author_id, recipient_id, thread_id, task_id, file_path, event_type, message, metadata)
    VALUES (?, ?, NULL, NULL, NULL, NULL, 'post', ?, '{}')
  `).run(Date.now(), '@system', 'Broadcast post to everyone');

  const bobBox = getAgentMailbox(db, '@bob');
  assert.strictEqual(bobBox.messages.rows.length, 2);
  assert.strictEqual(bobBox.unreadCount, 2);
  for (const row of bobBox.messages.rows) {
    assert.strictEqual(row[2], '@alice');
    assert.ok(row[6].startsWith('Bob msg'));
  }

  const aliceBox = getAgentMailbox(db, '@alice');
  assert.strictEqual(aliceBox.messages.rows.length, 1);
  assert.strictEqual(aliceBox.unreadCount, 1);
  assert.strictEqual(aliceBox.messages.rows[0][2], '@bob');
  assert.strictEqual(aliceBox.messages.rows[0][6], 'Alice msg 1');

  const bobBoxRead = getAgentMailbox(db, '@bob', { markRead: true });
  assert.strictEqual(bobBoxRead.unreadCount, 2);

  const bobBoxAfter = getAgentMailbox(db, '@bob');
  assert.strictEqual(bobBoxAfter.unreadCount, 0);
  for (const row of bobBoxAfter.messages.rows) {
    assert.ok(row[5] !== null, 'read_at should be populated');
  }

  const aliceBoxAfter = getAgentMailbox(db, '@alice');
  assert.strictEqual(aliceBoxAfter.unreadCount, 1);
  assert.strictEqual(aliceBoxAfter.messages.rows[0][5], null, 'Alice message should remain unread');

  const firstMsgId = bobBox.messages.rows[1][0];
  const bobBoxSince = getAgentMailbox(db, '@bob', { since: firstMsgId });
  assert.strictEqual(bobBoxSince.messages.rows.length, 1);
  assert.strictEqual(bobBoxSince.messages.rows[0][0], bobBox.messages.rows[0][0]);
});

test('empirical: atomic CAS task claiming under contention', () => {
  const db = setupDb();

  const task = createTask(db, { title: 'High Contention Task', status: 'queued' });
  assert.ok(task.id);

  const agents = ['@worker1', '@worker2', '@worker3', '@worker4', '@worker5'];
  for (const a of agents) {
    registerAgent(db, { id: a, role: 'contributor' });
  }

  const claimResults = agents.map(agentId => claimTask(db, task.id, agentId));

  const successfulClaims = claimResults.filter(r => r.success === true);
  const failedClaims = claimResults.filter(r => r.success === false);

  assert.strictEqual(successfulClaims.length, 1, 'Exactly one agent should succeed in claiming');
  assert.strictEqual(failedClaims.length, agents.length - 1, 'All other agents must fail');

  for (const failed of failedClaims) {
    assert.strictEqual(failed.reason, 'already_claimed');
  }

  const winningAgent = successfulClaims[0].task.assigned_agent_id;
  assert.ok(agents.includes(winningAgent));

  const refreshedTask = getTask(db, task.id);
  assert.strictEqual(refreshedTask.status, 'in_progress');
  assert.strictEqual(refreshedTask.assigned_agent_id, winningAgent);

  const winnerRecord = getAgent(db, winningAgent);
  assert.strictEqual(winnerRecord.status, 'busy');
  assert.strictEqual(winnerRecord.current_task_id, task.id);

  for (const a of agents) {
    if (a !== winningAgent) {
      const loserRecord = getAgent(db, a);
      assert.notStrictEqual(loserRecord.current_task_id, task.id, `${a} should not hold current_task_id`);
    }
  }

  const duplicateClaim = claimTask(db, task.id, winningAgent);
  assert.strictEqual(duplicateClaim.success, false);
  assert.strictEqual(duplicateClaim.reason, 'already_claimed');
});

test('empirical: atomic CAS edge cases - pre-assigned task, terminal state, unmet deps', () => {
  const db = setupDb();

  registerAgent(db, { id: '@agentA', role: 'contributor' });
  registerAgent(db, { id: '@agentB', role: 'contributor' });

  const preassignedTask = createTask(db, {
    title: 'Pre-assigned Task',
    status: 'queued',
    assigned_agent_id: '@agentA'
  });

  const bClaim = claimTask(db, preassignedTask.id, '@agentB');
  assert.strictEqual(bClaim.success, false);
  assert.strictEqual(bClaim.reason, 'already_claimed');

  const aClaim = claimTask(db, preassignedTask.id, '@agentA');
  assert.strictEqual(aClaim.success, true);
  assert.strictEqual(aClaim.task.assigned_agent_id, '@agentA');
  assert.strictEqual(aClaim.task.status, 'in_progress');

  const doneTask = createTask(db, { title: 'Finished Task', status: 'done' });
  const doneClaim = claimTask(db, doneTask.id, '@agentB');
  assert.strictEqual(doneClaim.success, false);
  assert.strictEqual(doneClaim.reason, 'already_claimed');

  const depTask = createTask(db, { title: 'Prerequisite Task', status: 'queued' });
  const blockedTask = createTask(db, {
    title: 'Blocked Task',
    status: 'queued',
    dependencies: [depTask.id]
  });

  const blockedClaim = claimTask(db, blockedTask.id, '@agentA');
  assert.strictEqual(blockedClaim.success, false);
  assert.strictEqual(blockedClaim.reason, 'dependencies_unmet');
});
