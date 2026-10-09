/**
 * Coordinator step (task #1997): it claims for the caller, respects a refused claim and never
 * completes in-progress work on its own.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { initProjectSession } from './team-projects.js';
import { createTask, getTask } from './team-db-tasks.js';
import { executeCoordinatorStep } from './team-projects-coordinator.js';

const createDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  initProjectSession(db, { title: 'Coordinator spec', goal: 'Exercise the step', budgetLimit: 1, maxTurns: 10 });
  return db;
};

test('coordinator: claims the queued task for the explicit caller handle', () => {
  const db = createDb();
  const queued = createTask(db, { title: 'Atom work', tier: 'atom' });
  const step = executeCoordinatorStep(db, { agentId: 'spec-runner', costUsd: 0.001 });
  assert.equal(step.status, 'ok');
  assert.equal(step.agent, '@spec-runner');
  assert.equal(getTask(db, queued.id).assigned_agent_id, '@spec-runner');
  assert.equal(getTask(db, queued.id).status, 'in_progress');
});

test('coordinator: a refused claim leaves the task queued and unassigned', () => {
  const db = createDb();
  const blocker = createTask(db, { title: 'Held elsewhere', status: 'in_progress', assigned_agent_id: '@someone-else' });
  const dependent = createTask(db, { title: 'Needs the blocker', dependencies: [blocker.id] });
  const step = executeCoordinatorStep(db, { agentId: '@spec-runner', costUsd: 0.001 });
  assert.equal(step.action, 'no_claimable_task');
  assert.equal(step.task, null);
  assert.deepEqual(step.refusals.map((r) => r.id), [dependent.id]);
  const after = getTask(db, dependent.id);
  assert.equal(after.status, 'queued');
  assert.equal(after.assigned_agent_id, null);
});

test('coordinator: in-progress work is reported, never auto-completed', () => {
  const db = createDb();
  const active = createTask(db, { title: 'Owner is working', status: 'in_progress', assigned_agent_id: '@owner' });
  const step = executeCoordinatorStep(db, { agentId: '@spec-runner', costUsd: 0.001 });
  assert.match(step.action, /^awaiting_1_active_task/);
  assert.equal(getTask(db, active.id).status, 'in_progress');
  assert.equal(getTask(db, active.id).assigned_agent_id, '@owner');
});
