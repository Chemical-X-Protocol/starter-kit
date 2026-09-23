import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { claimTask, createTask, getTask } from './team-db-tasks.js';
import { sendDirectMessage } from './team-db-mailbox.js';
import { requestFileLock, releaseFileLock, getFileLockStatus } from './team-db-locks.js';

const latencies = [];
const recordLatency = (start) => latencies.push(performance.now() - start);

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const assertLatency = (label) => {
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  assert.ok(median < 50, `${label} median latency ${median}ms exceeds 50ms`);
  assert.ok(p95 < 50, `${label} p95 latency ${p95}ms exceeds 50ms`);
};

test('concurrency stress: 10 agents race to claim same task with CAS', async () => {
  const db = setupDb();
  const task = createTask(db, { title: 'Contended Task', status: 'queued' });
  const agents = Array.from({ length: 10 }, (_, i) => `@agent-${i}`);

  const results = await Promise.all(agents.map(async (agentId) => {
    await new Promise((r) => setImmediate(r));
    const start = performance.now();
    const res = claimTask(db, task.id, agentId);
    recordLatency(start);
    return res;
  }));

  assert.strictEqual(results.filter((r) => r.success).length, 1);
  assert.strictEqual(results.filter((r) => !r.success && r.reason === 'already_claimed').length, 9);
  assert.strictEqual(getTask(db, task.id).status, 'in_progress');
});

test('concurrency stress: 10 agents send 200 DMs without busy errors', async () => {
  const db = setupDb();
  const agents = Array.from({ length: 10 }, (_, i) => `@sender-${i}`);
  const ops = agents.flatMap((sender, aIdx) =>
    Array.from({ length: 20 }, (_, mIdx) => async () => {
      await new Promise((r) => setImmediate(r));
      const start = performance.now();
      const dm = sendDirectMessage(db, {
        author_id: sender, recipient_id: `@rec-${mIdx % 5}`, message: `Msg ${aIdx}-${mIdx}`
      });
      recordLatency(start);
      return dm;
    })
  );

  const sent = await Promise.all(ops.map((op) => op()));
  assert.strictEqual(sent.length, 200);
  const dbIds = db.prepare("SELECT id FROM agent_feed WHERE event_type = 'dm' ORDER BY id ASC").all().map((r) => r.id);
  assert.ok(dbIds.every((id, idx) => idx === 0 || id === dbIds[idx - 1] + 1), 'Monotonic IDs');
  assert.strictEqual(dbIds.length, 200);
});

test('concurrency stress: lock contention across multiple files and latency check', async () => {
  const db = setupDb();
  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
  const agents = ['@worker-0', '@worker-1', '@worker-2'];

  for (const file of files) {
    const acquireResults = await Promise.all(agents.map(async (agent) => {
      await new Promise((r) => setImmediate(r));
      const start = performance.now();
      const res = requestFileLock(db, file, agent, { purpose: 'edit' });
      recordLatency(start);
      return { agent, ...res };
    }));

    const granted = acquireResults.filter((r) => r.granted);
    assert.strictEqual(granted.length, 1);
    const holder = granted[0].agent;

    assert.strictEqual(getFileLockStatus(db, file).lease.locked_by, holder);
    assert.strictEqual(getFileLockStatus(db, file).waiters.length, 2);

    const startRel = performance.now();
    const rel = releaseFileLock(db, file, holder);
    recordLatency(startRel);
    assert.strictEqual(rel.success, true);
    assert.strictEqual(getFileLockStatus(db, file).lease.locked_by, rel.promotedWaiter);
  }

  assertLatency('Sub-50ms latency assertion');
});
