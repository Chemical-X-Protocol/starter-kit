import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';

import { initTeamSchema } from './team-schema.js';
import { createTask, getTask } from './team-db.js';
import {
  parseVdsVersion,
  calculateNextTrainVersion,
  freezeReleaseTrain
} from './team-release-train.js';
import { handleTrainCommand } from './team-commands-vds.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('team-release-train: parseVdsVersion decomposes semver tokens cleanly', () => {
  const v1 = parseVdsVersion('v2025.1.0');
  assert.strictEqual(v1.year, 2025);
  assert.strictEqual(v1.minor, 1);
  assert.strictEqual(v1.patch, 0);

  const v2 = parseVdsVersion('2026.3.14');
  assert.strictEqual(v2.year, 2026);
  assert.strictEqual(v2.minor, 3);
  assert.strictEqual(v2.patch, 14);
});

test('team-release-train: calculateNextTrainVersion handles midweek freeze patch bumps', () => {
  const now = new Date(2025, 9, 23); // Oct 2025
  const patchBump = calculateNextTrainVersion('v2025.1.0', 'midweek_freeze', now);
  assert.strictEqual(patchBump, 'v2025.1.1');

  const secondPatch = calculateNextTrainVersion('v2025.1.1', 'midweek_freeze', now);
  assert.strictEqual(secondPatch, 'v2025.1.2');
});

test('team-release-train: calculateNextTrainVersion handles sprint start minor bumps', () => {
  const now = new Date(2025, 9, 27);
  const sprintStart = calculateNextTrainVersion('v2025.1.2', 'sprint_start', now);
  assert.strictEqual(sprintStart, 'v2025.2.0');
});

test('team-release-train: calculateNextTrainVersion handles year rollover major bumps', () => {
  const nextYear = new Date(2026, 0, 5); // Jan 2026
  const rollover = calculateNextTrainVersion('v2025.3.4', 'year_rollover', nextYear);
  assert.strictEqual(rollover, 'v2026.0.0');
});

test('team-release-train: freezeReleaseTrain tags candidate payloads and logs feed event', () => {
  const db = setupTestDb();

  const t1 = createTask(db, { title: 'PR Ready for Tag 1', vds_status: 'awaiting_tag' });
  const t2 = createTask(db, { title: 'PR in Review 2', status: 'review' });

  const freezeRes = freezeReleaseTrain(db, {
    baseTag: 'v2025.1.0',
    eventType: 'midweek_freeze',
    date: new Date(2025, 9, 23)
  });

  assert.strictEqual(freezeRes.success, true);
  assert.strictEqual(freezeRes.version, 'v2025.1.1');
  assert.strictEqual(freezeRes.candidateCount, 2);

  const updatedT1 = getTask(db, t1.id);
  const updatedT2 = getTask(db, t2.id);

  assert.strictEqual(updatedT1.vds_status, 'tagged');
  assert.strictEqual(updatedT1.vds_phase, 'delivery');
  assert.strictEqual(updatedT1.sprint_tag, 'v2025.1.1');

  assert.strictEqual(updatedT2.vds_status, 'tagged');
  assert.strictEqual(updatedT2.sprint_tag, 'v2025.1.1');

  // Verify activity feed log
  const feedEvent = db.prepare("SELECT * FROM agent_feed WHERE event_type = 'release_train_freeze'").get();
  assert.ok(feedEvent);
  assert.ok(feedEvent.message.includes('v2025.1.1'));
});

test('team-release-train: handleTrainCommand status returns train metadata', () => {
  const db = setupTestDb();
  createTask(db, { title: 'Pending Review', status: 'review' });

  const status = handleTrainCommand(db, 'status');
  assert.strictEqual(status.pendingCandidates, 1);
});
