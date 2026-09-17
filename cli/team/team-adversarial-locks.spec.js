/**
 * Chemical X Protocol: Adversarial Lock & FIFO Queue Stress Test
 * Validates PK exclusivity, strict FIFO & priority preemption, and zero-deadlock draining
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

const setupMemoryDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initTeamSchema(db);
  return db;
};

test('adversarial-locks: PK exclusivity and deterministic queue order for 10 contenders', () => {
  const db = setupMemoryDb();
  const file = 'src/molecules/m-card/m-card.vue';
  const contenders = Array.from({ length: 10 }, (_, i) => `@agent-${i}`);

  const firstResult = requestFileLock(db, file, contenders[0], { purpose: 'Initial hold' });
  assert.equal(firstResult.granted, true);
  assert.equal(firstResult.lease.locked_by, contenders[0]);

  for (let i = 1; i < contenders.length; i += 1) {
    const queued = requestFileLock(db, file, contenders[i], { purpose: `Queue ${i}` });
    assert.equal(queued.granted, false);
    assert.equal(queued.queued, true);
    assert.equal(queued.position, i);
  }

  const leaseCount = db.prepare('SELECT COUNT(*) as c FROM file_leases WHERE file_path = ?').get(file).c;
  assert.equal(leaseCount, 1, 'PK Exclusivity Violation: Multiple leases found for same file');

  for (let i = 0; i < contenders.length - 1; i += 1) {
    const rel = releaseFileLock(db, file, contenders[i]);
    assert.equal(rel.success, true);
    assert.equal(rel.promotedWaiter, contenders[i + 1]);
  }

  const lastRel = releaseFileLock(db, file, contenders[contenders.length - 1]);
  assert.equal(lastRel.success, true);
  assert.equal(lastRel.promotedWaiter, null);
  assert.equal(getFileLockStatus(db, file).lease, null);
});

test('adversarial-locks: multi-tier priority preemption and FIFO tie-breaking', () => {
  const db = setupMemoryDb();
  const file = 'src/organism/header.vue';
  requestFileLock(db, file, '@holder', { purpose: 'Active lock' });

  // Enqueue mixed priorities: P3, P1_A, P2_A, P1_B, P2_B
  requestFileLock(db, file, '@waiter-p3', { priority: 3 });
  requestFileLock(db, file, '@waiter-p1-a', { priority: 1 });
  requestFileLock(db, file, '@waiter-p2-a', { priority: 2 });
  requestFileLock(db, file, '@waiter-p1-b', { priority: 1 });
  requestFileLock(db, file, '@waiter-p2-b', { priority: 2 });

  const expectedOrder = ['@waiter-p1-a', '@waiter-p1-b', '@waiter-p2-a', '@waiter-p2-b', '@waiter-p3'];
  let currentHolder = '@holder';

  for (const expected of expectedOrder) {
    const rel = releaseFileLock(db, file, currentHolder);
    assert.equal(rel.success, true);
    assert.equal(rel.promotedWaiter, expected);
    currentHolder = expected;
  }

  const finalRel = releaseFileLock(db, file, currentHolder);
  assert.equal(finalRel.success, true);
  assert.equal(finalRel.promotedWaiter, null);
});

test('adversarial-locks: renewal idempotency, rogue release rejection, and expiration promo', () => {
  const db = setupMemoryDb();
  const file = 'src/atoms/button.vue';
  const initial = requestFileLock(db, file, '@owner', { purpose: 'V1', ttlMs: 10000 });
  assert.equal(initial.granted, true);

  // Renewal should be idempotent without duplicate queueing
  const renewed = requestFileLock(db, file, '@owner', { purpose: 'V2', ttlMs: 20000 });
  assert.equal(renewed.granted, true);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM file_leases WHERE file_path = ?').get(file).c, 1);

  // Rogue agent cannot unlock
  const rogueUnlock = releaseFileLock(db, file, '@intruder');
  assert.equal(rogueUnlock.success, false);
  assert.equal(rogueUnlock.reason, 'not_holder');

  // Next waiter queued
  requestFileLock(db, file, '@next-in-line');
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - 5000, file);

  const expired = cleanExpiredLeases(db);
  assert.equal(expired.length, 1);
  assert.equal(getFileLockStatus(db, file).lease.locked_by, '@next-in-line');
});
