/**
 * Chemical X Protocol: Adversarial Token Telemetry & Ingestion Test
 * Validates token aggregation, cost derivation, agent accumulation, and completion hooks
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { registerAgent } from './team-db-agents.js';
import { createTask, getTask } from './team-db-tasks.js';
import { requestFileLock, getFileLockStatus } from './team-db-locks.js';
import { getSwarmStatus } from './team-db.js';
import { ingestTaskTelemetry, completeTaskWithAudit } from './team-triage.js';

const setupMemoryDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT '',
      lines INTEGER NOT NULL DEFAULT 0,
      chars INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  initTeamSchema(db);
  return db;
};

test('adversarial-telemetry: structured ingestion computes cost and updates agent totals', () => {
  const db = setupMemoryDb();
  registerAgent(db, { id: '@worker-tel', name: 'Tel Worker', role: 'developer' });
  const task = createTask(db, { title: 'Implement telemetry', priority: 1 });

  const result = ingestTaskTelemetry(db, task.id, '@worker-tel', {
    tokens: { prompt: 10000, completion: 4000, cached: 2000 }
  });

  // Cost: (10000 * 0.0000025) + (4000 * 0.00001) = 0.025 + 0.040 = 0.065
  assert.equal(result.prompt_tokens, 10000);
  assert.equal(result.completion_tokens, 4000);
  assert.equal(result.total_tokens, 14000);
  assert.equal(result.cost_usd, 0.065);

  const taskRow = getTask(db, task.id);
  assert.equal(taskRow.prompt_tokens, 10000);
  assert.equal(taskRow.cost_usd, 0.065);

  const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get('@worker-tel');
  assert.equal(agentRow.total_tokens, 14000);
  assert.equal(agentRow.total_cost_usd, 0.065);
});

test('adversarial-telemetry: completeTaskWithAudit releases lock, sets done, and records telemetry', () => {
  const db = setupMemoryDb();
  const agent = '@worker-audit';
  const file = 'src/capsules/m-panel.vue';
  registerAgent(db, { id: agent, name: 'Auditor', role: 'auditor' });
  const task = createTask(db, { title: 'Audit panel', target_path: file });

  requestFileLock(db, file, agent, { purpose: 'Auditing' });
  assert.notEqual(getFileLockStatus(db, file).lease, null);

  const doneTask = completeTaskWithAudit(db, task.id, agent, {
    tokens: { prompt: 2000, completion: 1000 }
  });

  assert.equal(doneTask.status, 'done');
  assert.equal(getFileLockStatus(db, file).lease, null, 'Lease must be auto-released upon task completion');
  assert.equal(doneTask.prompt_tokens, 2000);
  assert.equal(doneTask.completion_tokens, 1000);
  assert.equal(doneTask.cost_usd, 0.015);
});

test('adversarial-telemetry: getSwarmStatus accurately aggregates swarm-wide telemetry', () => {
  const db = setupMemoryDb();
  const t1 = createTask(db, { title: 'Task 1' });
  const t2 = createTask(db, { title: 'Task 2' });

  ingestTaskTelemetry(db, t1.id, '@a1', { tokens: { prompt: 3000, completion: 1000 } }); // cost 0.0175
  ingestTaskTelemetry(db, t2.id, '@a2', { tokens: { prompt: 5000, completion: 2000 } }); // cost 0.0325

  const status = getSwarmStatus(db);
  assert.equal(status.tokens.prompt, 8000);
  assert.equal(status.tokens.completion, 3000);
  assert.equal(status.tokens.total, 11000);
  assert.equal(status.tokens.cost_usd, 0.05);
});
