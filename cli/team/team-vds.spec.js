import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';

import { initTeamSchema } from './team-schema.js';
import { createTask, getTask } from './team-db.js';
import {
  VDS_MOSCOW,
  VDS_PRIORITIES,
  VDS_PHASES,
  VDS_STATUSES,
  generateTaskPermalink,
  verifyTraceability,
  enforceSingleSlot
} from './team-vds.js';
import { handleTaskSlotCommand, handleTaskTraceCommand } from './team-commands-vds.js';
import { executeMcpTool } from '../mcp/tools.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('team-vds: constants adhere strictly to VDS specification', () => {
  assert.deepStrictEqual(VDS_MOSCOW, ['must', 'should', 'could', 'wont']);
  assert.deepStrictEqual(VDS_PRIORITIES, ['critical', 'expedite', 'high', 'medium', 'low']);
  assert.deepStrictEqual(VDS_PHASES, ['planning', 'execution', 'delivery']);
  assert.strictEqual(VDS_STATUSES.length, 9);
  assert.ok(VDS_STATUSES.includes('ready'));
  assert.ok(VDS_STATUSES.includes('awaiting_tag'));
  assert.ok(VDS_STATUSES.includes('tagged'));
});

test('team-vds: generateTaskPermalink produces canonical self-hosted URLs', () => {
  const link = generateTaskPermalink(42, 'http://localhost:3000');
  assert.strictEqual(link, 'http://localhost:3000/tasks/42');

  const defaultLink = generateTaskPermalink(101);
  assert.strictEqual(defaultLink, 'http://localhost:3000/tasks/101');
});

test('team-vds: verifyTraceability enforces canonical task permalink anchor', () => {
  const validLocalhost = verifyTraceability('http://localhost:3000/tasks/12');
  assert.strictEqual(validLocalhost.valid, true);
  assert.strictEqual(validLocalhost.permalink, 'http://localhost:3000/tasks/12');

  const validIp = verifyTraceability('http://127.0.0.1:8080/tasks/99');
  assert.strictEqual(validIp.valid, true);

  const validRelative = verifyTraceability('/tasks/55');
  assert.strictEqual(validRelative.valid, true);

  const invalidEmpty = verifyTraceability('');
  assert.strictEqual(invalidEmpty.valid, false);

  const invalidExternal = verifyTraceability('https://randomsite.com/foo');
  assert.strictEqual(invalidExternal.valid, false);
});

test('team-vds: enforceSingleSlot and Displacement Protocol cascades demoted incumbents', () => {
  const db = setupTestDb();

  const task1 = createTask(db, { title: 'First Must Critical', moscow: 'must', vds_priority: 'critical' });
  assert.strictEqual(task1.moscow, 'must');
  assert.strictEqual(task1.vds_priority, 'critical');

  // Task 2 claims Must/Critical, displacing Task 1 to Must/Expedite
  const task2 = createTask(db, { title: 'Second Must Critical' });
  const slotRes = enforceSingleSlot(db, task2.id, 'must', 'critical');

  assert.strictEqual(slotRes.success, true);
  assert.strictEqual(slotRes.displaced.length, 1);
  assert.strictEqual(slotRes.displaced[0].id, task1.id);
  assert.strictEqual(slotRes.displaced[0].to.priority, 'expedite');

  const updatedTask1 = getTask(db, task1.id);
  const updatedTask2 = getTask(db, task2.id);

  assert.strictEqual(updatedTask2.moscow, 'must');
  assert.strictEqual(updatedTask2.vds_priority, 'critical');
  assert.strictEqual(updatedTask1.moscow, 'must');
  assert.strictEqual(updatedTask1.vds_priority, 'expedite');
});

test('team-vds: multi-step displacement cascades down through priorities and buckets', () => {
  const db = setupTestDb();

  const t1 = createTask(db, { title: 'Task 1' });
  enforceSingleSlot(db, t1.id, 'must', 'critical');

  const t2 = createTask(db, { title: 'Task 2' });
  enforceSingleSlot(db, t2.id, 'must', 'expedite');

  // Task 3 claims Must/Critical -> Displaces Task 1 to Expedite -> Displaces Task 2 to High
  const t3 = createTask(db, { title: 'Task 3' });
  const cascadeRes = enforceSingleSlot(db, t3.id, 'must', 'critical');

  assert.strictEqual(cascadeRes.success, true);
  assert.strictEqual(cascadeRes.displaced.length, 2);

  const afterT1 = getTask(db, t1.id);
  const afterT2 = getTask(db, t2.id);
  const afterT3 = getTask(db, t3.id);

  assert.strictEqual(afterT3.vds_priority, 'critical');
  assert.strictEqual(afterT1.vds_priority, 'expedite');
  assert.strictEqual(afterT2.vds_priority, 'high');
});

test('team-vds: CLI commands slot and trace operate cleanly', () => {
  const db = setupTestDb();
  const task = createTask(db, { title: 'CLI VDS Task' });

  const slotRes = handleTaskSlotCommand(db, task.id, 'should', 'high');
  assert.strictEqual(slotRes.success, true);
  const slotted = getTask(db, task.id);
  assert.strictEqual(slotted.moscow, 'should');
  assert.strictEqual(slotted.vds_priority, 'high');

  const traceRes = handleTaskTraceCommand(db, task.id, 'http://localhost:3000/tasks/' + task.id);
  assert.strictEqual(traceRes.success, true);
  const traced = getTask(db, task.id);
  assert.strictEqual(traced.task_url, 'http://localhost:3000/tasks/' + task.id);
});
