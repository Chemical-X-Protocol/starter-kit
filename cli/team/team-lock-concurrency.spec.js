/**
 * Chemical X Protocol: FIFO Lock Queue & Concurrency Stress Test Suite
 * Verifies deterministic FIFO queueing, priority preemption, and auto-promotion
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import {
  requestFileLock,
  releaseFileLock,
  getFileLockStatus,
  cleanExpiredLeases
} from './team-db-locks.js';
import { queryFeed } from './team-db-feed.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initTeamSchema(db);
  return db;
};

test('lock-concurrency: deterministic FIFO queueing and sequential promotion', () => {
  const db = setupDb();
  const file = 'src/components/Card.vue';
  const agents = ['@agent-0', '@agent-1', '@agent-2', '@agent-3', '@agent-4'];

  const initial = requestFileLock(db, file, agents[0], { purpose: 'Initial edit' });
  assert.equal(initial.granted, true);
  assert.equal(initial.lease.locked_by, agents[0]);

  for (let i = 1; i < agents.length; i += 1) {
    const queued = requestFileLock(db, file, agents[i], { purpose: `Queued edit ${i}` });
    assert.equal(queued.granted, false);
    assert.equal(queued.queued, true);
    assert.equal(queued.position, i);
    assert.equal(queued.currentHolder, agents[0]);
  }

  const initialStatus = getFileLockStatus(db, file);
  assert.equal(initialStatus.lease.locked_by, agents[0]);
  assert.equal(initialStatus.waiters.length, 4);

  for (let i = 0; i < agents.length - 1; i += 1) {
    const releaseRes = releaseFileLock(db, file, agents[i]);
    const expectedNext = agents[i + 1];
    assert.equal(releaseRes.success, true);
    assert.equal(releaseRes.promotedWaiter, expectedNext);

    const currentStatus = getFileLockStatus(db, file);
    assert.equal(currentStatus.lease.locked_by, expectedNext);
    assert.equal(currentStatus.waiters.length, agents.length - 2 - i);
  }

  const finalRelease = releaseFileLock(db, file, agents[agents.length - 1]);
  assert.equal(finalRelease.success, true);
  assert.equal(finalRelease.promotedWaiter, null);

  const finalStatus = getFileLockStatus(db, file);
  assert.equal(finalStatus.lease, null);
  assert.equal(finalStatus.waiters.length, 0);
});

test('lock-concurrency: priority-based queue promotion orders by priority ASC, id ASC', () => {
  const db = setupDb();
  const file = 'src/services/data.ts';

  requestFileLock(db, file, '@holder', { purpose: 'Active holder' });

  requestFileLock(db, file, '@low-prio', { priority: 3, purpose: 'Low priority' });
  requestFileLock(db, file, '@urgent-a', { priority: 1, purpose: 'Urgent priority A' });
  requestFileLock(db, file, '@normal-prio', { priority: 2, purpose: 'Normal priority' });
  requestFileLock(db, file, '@urgent-b', { priority: 1, purpose: 'Urgent priority B' });

  const r1 = releaseFileLock(db, file, '@holder');
  assert.equal(r1.promotedWaiter, '@urgent-a');

  const r2 = releaseFileLock(db, file, '@urgent-a');
  assert.equal(r2.promotedWaiter, '@urgent-b');

  const r3 = releaseFileLock(db, file, '@urgent-b');
  assert.equal(r3.promotedWaiter, '@normal-prio');

  const r4 = releaseFileLock(db, file, '@normal-prio');
  assert.equal(r4.promotedWaiter, '@low-prio');

  const r5 = releaseFileLock(db, file, '@low-prio');
  assert.equal(r5.promotedWaiter, null);
});

test('lock-concurrency: lease expiration auto-promotes waiting contender', () => {
  const db = setupDb();
  const file = 'src/models/session.ts';

  requestFileLock(db, file, '@slow-worker', { purpose: 'Expired work' });
  requestFileLock(db, file, '@waiting-worker', { purpose: 'Next work' });

  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - 1000, file);

  const expired = cleanExpiredLeases(db);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].file_path, file);

  const status = getFileLockStatus(db, file);
  assert.equal(status.lease.locked_by, '@waiting-worker');
  assert.equal(status.waiters.length, 0);

  const events = queryFeed(db, { file_path: file });
  const hasExpiredEvent = events.some((e) => e.event_type === 'lock_expired');
  const hasGrantedEvent = events.some((e) => e.event_type === 'lock_granted');
  assert.equal(hasExpiredEvent, true);
  assert.equal(hasGrantedEvent, true);
});

test('lock-concurrency: lease renewal is idempotent without duplicate entries', () => {
  const db = setupDb();
  const file = 'src/utils/math.ts';

  const first = requestFileLock(db, file, '@worker', { purpose: 'Step 1' });
  assert.equal(first.granted, true);

  const renewed = requestFileLock(db, file, '@worker', { purpose: 'Step 2 extension' });
  assert.equal(renewed.granted, true);
  assert.equal(renewed.lease.locked_by, '@worker');

  const leases = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').all(file);
  assert.equal(leases.length, 1);
  assert.equal(leases[0].purpose, 'Step 2 extension');

  const waiters = db.prepare('SELECT * FROM file_lock_queue WHERE file_path = ?').all(file);
  assert.equal(waiters.length, 0);
});

test('lock-concurrency: unauthorized release attempts are rejected safely', () => {
  const db = setupDb();
  const file = 'src/config/keys.ts';

  requestFileLock(db, file, '@legit-owner', { purpose: 'Config update' });

  const failed = releaseFileLock(db, file, '@rogue-agent');
  assert.equal(failed.success, false);
  assert.equal(failed.reason, 'not_holder');

  const status = getFileLockStatus(db, file);
  assert.equal(status.lease.locked_by, '@legit-owner');
});

test('lock-concurrency: high-frequency interleaved stress test with zero deadlocks', () => {
  const db = setupDb();
  const files = ['src/a.ts', 'src/b.ts'];
  const agentPool = ['@w1', '@w2', '@w3', '@w4', '@w5', '@w6'];

  for (let cycle = 0; cycle < 20; cycle += 1) {
    const file = files[cycle % files.length];
    const agent = agentPool[cycle % agentPool.length];
    const op = cycle % 3;

    if (op === 0 || op === 1) {
      requestFileLock(db, file, agent, { purpose: `Cycle ${cycle}` });
    } else {
      releaseFileLock(db, file, agent);
    }

    const leases = db.prepare('SELECT COUNT(*) as count FROM file_leases WHERE file_path = ?').get(file);
    assert.ok(leases.count <= 1, 'Inconsistent lease count: must never exceed 1');
  }

  for (const file of files) {
    let safety = 0;
    while (safety < 30) {
      safety += 1;
      const status = getFileLockStatus(db, file);
      if (!status || !status.lease) break;
      releaseFileLock(db, file, status.lease.locked_by);
    }
    const final = getFileLockStatus(db, file);
    assert.equal(final.lease, null);
    assert.equal(final.waiters.length, 0);
  }
});
