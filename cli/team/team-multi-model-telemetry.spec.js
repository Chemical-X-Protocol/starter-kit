import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import {
  MODEL_PRICING,
  DEFAULT_MODEL,
  resolveModelPricing,
  calculateCost,
  ingestTaskTelemetry
} from './team-telemetry.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

test('team-telemetry: rate cards defined for all canonical models', () => {
  assert.deepStrictEqual(MODEL_PRICING['frontier-blended'], { prompt: 0.0000025, completion: 0.0000100 });
  assert.deepStrictEqual(MODEL_PRICING['claude-3-5-sonnet'], { prompt: 0.0000030, completion: 0.0000150 });
  assert.deepStrictEqual(MODEL_PRICING['gpt-4o'], { prompt: 0.0000025, completion: 0.0000100 });
  assert.deepStrictEqual(MODEL_PRICING['local'], { prompt: 0.0000000, completion: 0.0000000 });
  assert.strictEqual(DEFAULT_MODEL, 'frontier-blended');
});

test('team-telemetry: resolveModelPricing falls back to frontier-blended', () => {
  const resolvedClaude = resolveModelPricing('claude-3-5-sonnet-20241022');
  assert.strictEqual(resolvedClaude.prompt, 0.0000030);

  const resolvedGpt = resolveModelPricing('gpt-4o-mini');
  assert.strictEqual(resolvedGpt.prompt, 0.0000025);

  const resolvedLocal = resolveModelPricing('local-llama-3');
  assert.strictEqual(resolvedLocal.prompt, 0.0);

  const resolvedUnknown = resolveModelPricing('custom-exotic-model');
  assert.strictEqual(resolvedUnknown.prompt, 0.0000025);

  const resolvedEmpty = resolveModelPricing('');
  assert.strictEqual(resolvedEmpty.prompt, 0.0000025);
});

test('team-telemetry: calculateCost accurately derives micro-USD costs', () => {
  const costDefault = calculateCost(1000, 1000);
  assert.strictEqual(costDefault, 0.0125);

  const costClaude = calculateCost(1000, 1000, 'claude-3-5-sonnet');
  assert.strictEqual(costClaude, 0.018);

  const costLocal = calculateCost(5000, 5000, 'local');
  assert.strictEqual(costLocal, 0.0);

  const costObject = calculateCost({ promptTokens: 2000, completionTokens: 1000, model: 'claude-3-5-sonnet' });
  assert.strictEqual(costObject, 0.021);
});

test('team-telemetry: ingestTaskTelemetry applies model pricing card to database records', () => {
  const db = setupTestDb();
  const now = Date.now();
  db.prepare("INSERT INTO agents (id, name, role, heartbeat) VALUES ('@worker-m1', 'Worker M1', 'implementer', ?)").run(now);
  const taskRes = db.prepare("INSERT INTO agent_tasks (title, tier, status, created_at, updated_at) VALUES ('Test M1 Task', 'backend', 'done', ?, ?)").run(now, now);
  const taskId = Number(taskRes.lastInsertRowid);

  const result = ingestTaskTelemetry(db, taskId, '@worker-m1', {
    model: 'claude-3-5-sonnet',
    tokens: { prompt: 2000, completion: 1000 }
  });

  assert.ok(result);
  assert.strictEqual(result.prompt_tokens, 2000);
  assert.strictEqual(result.completion_tokens, 1000);
  assert.strictEqual(result.cost_usd, 0.021);

  const taskRow = db.prepare('SELECT cost_usd, prompt_tokens, completion_tokens FROM agent_tasks WHERE id = ?').get(taskId);
  assert.strictEqual(taskRow.cost_usd, 0.021);

  const agentRow = db.prepare('SELECT total_cost_usd FROM agents WHERE id = ?').get('@worker-m1');
  assert.strictEqual(agentRow.total_cost_usd, 0.021);
});
