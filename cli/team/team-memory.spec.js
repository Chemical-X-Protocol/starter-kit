import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";
import { openIndexDb } from "../search-db.js";
import {
  recordMemoryInjection,
  recordMemoryUtilization,
  evictExpiredMemories,
  calculateMemoryMetrics,
  runAblationComparison,
  formatAblationCard
} from "./team-memory.js";

const withTmpCwd = async (fn) => {
  const orig = process.cwd();
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chemx-mem-"));
  try {
    process.chdir(tmpCwd);
    const db = openIndexDb(tmpCwd);
    return await fn(db, tmpCwd);
  } finally {
    process.chdir(orig);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }
};

test("recordMemoryInjection logs volatile and durable entries", () => withTmpCwd((db) => {
  const durable = recordMemoryInjection(db, {
    taskId: 101, agentId: "@agent-1", type: "ast_symbol", provenance: "src/a.ts", tokens: 150
  });
  assert.strictEqual(durable.taskId, 101);
  assert.strictEqual(durable.tokens, 150);
  assert.strictEqual(durable.ttlExpiresAt, null);

  const volatile = recordMemoryInjection(db, {
    taskId: 101, agentId: "@agent-1", type: "transient_lock", provenance: "lock:file.ts", tokens: 50, ttlSeconds: 1
  });
  assert.ok(volatile.ttlExpiresAt > Date.now());
}));

test("recordMemoryUtilization and retry tracking", () => withTmpCwd((db) => {
  recordMemoryInjection(db, { taskId: 201, provenance: "src/target.ts", tokens: 200 });
  recordMemoryUtilization(db, { taskId: 201, utilizedProvenance: ["src/target.ts"], causedRetry: false });
  let m = calculateMemoryMetrics(db);
  assert.strictEqual(m.utilizedTokens, 200);
  assert.strictEqual(m.precisionPct, 100);
  assert.strictEqual(m.staleRetries, 0);

  recordMemoryUtilization(db, { taskId: 201, causedRetry: true });
  m = calculateMemoryMetrics(db);
  assert.strictEqual(m.staleRetries, 1);
}));

test("evictExpiredMemories purges expired entries and retains durable ones", () => withTmpCwd((db) => {
  recordMemoryInjection(db, { taskId: 301, provenance: "durable.ts", tokens: 100 });
  recordMemoryInjection(db, { taskId: 301, provenance: "expired.ts", tokens: 50, ttlSeconds: -10 });
  const evicted = evictExpiredMemories(db);
  assert.strictEqual(evicted, 1);
  const rows = db.prepare("SELECT * FROM agent_memory_log").all();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].provenance_path, "durable.ts");
}));

test("runAblationComparison and formatAblationCard generate metrics card without em dashes", () => withTmpCwd((db) => {
  const ablation = runAblationComparison(db);
  assert.strictEqual(ablation.memoryEnabled.astQualityScore, 100);
  assert.strictEqual(ablation.memoryDisabled.astQualityScore, 84);
  assert.ok(ablation.delta.tokenReductionPct >= 90);
  assert.strictEqual(ablation.hasRealData, false);
  assert.strictEqual(ablation.isSimulated, true);
  const card = formatAblationCard(ablation);
  assert.ok(card.includes("Persistent Memory Ablation Benchmark"));
  assert.ok(card.includes("Reference Projection"));
  assert.strictEqual(card.includes("—"), false);
}));

test("runAblationComparison computes dynamic metrics from live task and memory records", () => withTmpCwd((db) => {
  db.prepare(`
    INSERT INTO agent_tasks (title, status, prompt_tokens, completion_tokens, cost_usd, created_at, updated_at)
    VALUES ('Refactor parser', 'done', 1500, 300, 0.05, 1000, 1000)
  `).run();

  recordMemoryInjection(db, { taskId: 1, provenance: "src/parser.ts", tokens: 200 });
  recordMemoryUtilization(db, { taskId: 1, utilizedProvenance: ["src/parser.ts"], causedRetry: false });

  const ablation = runAblationComparison(db);
  assert.strictEqual(ablation.hasRealData, true);
  assert.strictEqual(ablation.isSimulated, false);
  assert.strictEqual(ablation.workloadTurns, 2);
  assert.strictEqual(ablation.memoryEnabled.tokensUsed, 1800);
  assert.ok(ablation.delta.tokenReductionPct > 0);
  assert.ok(ablation.delta.retrievalPrecisionGainRatio.endsWith('x'));

  const card = formatAblationCard(ablation);
  assert.ok(card.includes("Live Project Telemetry"));
  assert.ok(card.includes("measured vs modeled baseline"));
  assert.strictEqual(ablation.hasMeasuredTokens, true);
  assert.strictEqual(ablation.delta.isEstimated, false);
  assert.strictEqual(ablation.delta.tokenReductionBasis, "measured");
  assert.strictEqual(card.includes("—"), false);
}));

test("runAblationComparison marks token reduction as estimated when live tasks lack token counts", () => withTmpCwd((db) => {
  db.prepare(`
    INSERT INTO agent_tasks (title, status, created_at, updated_at)
    VALUES ('Task without token telemetry', 'done', 1000, 1000)
  `).run();

  const ablation = runAblationComparison(db);
  assert.strictEqual(ablation.hasRealData, true);
  assert.strictEqual(ablation.hasMeasuredTokens, false);
  assert.strictEqual(ablation.delta.isEstimated, true);
  assert.strictEqual(ablation.delta.tokenReductionBasis, "estimated_typical_usage");
  assert.strictEqual(ablation.delta.tokenReductionPct, 97);

  const card = formatAblationCard(ablation);
  assert.ok(card.includes("estimated based on typical usage"));
  assert.ok(card.includes("(projected)"));
  assert.strictEqual(card.includes("—"), false);
}));

