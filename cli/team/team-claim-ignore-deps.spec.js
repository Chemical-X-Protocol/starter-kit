import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { registerAgent } from './team-db-agents.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';

const setup = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  registerAgent(db, { id: '@w1', role: 'coder' });
  const parent = createTask(db, { title: 'parent' });
  const child = createTask(db, { title: 'child', dependencies: [parent.id] });
  return { db, child };
};

test('claim with unmet deps is refused without ignoreDeps', () => {
  const { db, child } = setup();
  assert.strictEqual(claimTask(db, child.id, '@w1').reason, 'dependencies_unmet');
  assert.strictEqual(claimTask(db, child.id, '@w1', { ignoreDeps: '  ' }).reason, 'dependencies_unmet');
});

test('claim with ignoreDeps succeeds and records the reason', () => {
  const { db, child } = setup();
  const res = claimTask(db, child.id, '@w1', { ignoreDeps: 'work landed first' });
  assert.strictEqual(res.success, true);
  const override = getTask(db, child.id).result_payload.deps_override;
  assert.strictEqual(override.reason, 'work landed first');
  assert.strictEqual(override.by, '@w1');
});
