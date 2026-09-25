/**
 * Chemical X Protocol: Adversarial Lock & FIFO Queue Stress Test
 * Validates PK exclusivity, strict FIFO & priority preemption, and zero-deadlock draining
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openIndexDb } from '../search-db.js';
import { runTeamCli } from './team-commands.js';
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

test('adversarial-locks: CLI mutual exclusion between two separate agent invocations prevents overwrite and queues second agent', () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-exclusion-'));
  try {
    const db = openIndexDb(tmpCwd);
    initTeamSchema(db);
    const testFile = 'src/components/button.vue';

    // Agent 1 acquires the lock via CLI
    const res1 = runTeamCli(['lock', 'acquire', testFile, '--as', '@agent-1'], false, tmpCwd);
    assert.equal(res1.granted, true);
    assert.equal(res1.lease.locked_by, '@agent-1');

    // Agent 2 attempts to acquire the lock on the same file via CLI
    const res2 = runTeamCli(['lock', 'acquire', testFile, '--as', '@agent-2'], false, tmpCwd);
    assert.equal(res2.granted, false);
    assert.equal(res2.queued, true);
    assert.equal(res2.position, 1);
    assert.equal(res2.currentHolder, '@agent-1');

    // Verify .chemx/index.db state: Agent 1's lease was NOT overwritten
    const leaseRow = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(testFile);
    assert.ok(leaseRow, 'Lease row must exist');
    assert.equal(leaseRow.locked_by, '@agent-1', 'Lease must still be held by agent-1, never overwritten');

    // Verify Agent 2 is recorded in file_lock_queue
    const queueRows = db.prepare('SELECT * FROM file_lock_queue WHERE file_path = ?').all(testFile);
    assert.equal(queueRows.length, 1);
    assert.equal(queueRows[0].agent_id, '@agent-2');
    assert.equal(queueRows[0].status, 'waiting');

    // Agent 1 releases the lock via CLI
    const relRes = runTeamCli(['lock', 'release', testFile, '--as', '@agent-1'], false, tmpCwd);
    assert.equal(relRes.success, true);
    assert.equal(relRes.promotedWaiter, '@agent-2');

    // Verify Agent 2 was promoted to active lease
    const promotedLease = db.prepare('SELECT * FROM file_leases WHERE file_path = ?').get(testFile);
    assert.equal(promotedLease.locked_by, '@agent-2');
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});

test('team-cli: help commands display correctly and do not fall through to list', () => {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-help-test-'));
  try {
    const db = openIndexDb(tmpCwd);
    initTeamSchema(db);

    const teamHelp = runTeamCli(['--help'], false, tmpCwd);
    assert.equal(teamHelp.help, true);
    assert.ok(teamHelp.commands.includes('task'));

    const taskHelp = runTeamCli(['task', '--help'], false, tmpCwd);
    assert.equal(taskHelp.help, true);
    assert.ok(taskHelp.actions.includes('list'));
    assert.ok(taskHelp.actions.includes('claim'));

    const lockHelp = runTeamCli(['lock', '--help'], false, tmpCwd);
    assert.equal(lockHelp.help, true);
    assert.ok(lockHelp.actions.includes('acquire'));
  } finally {
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
});
