import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, getTask } from './team-db-tasks.js';
import { autoGenerateTasksFromAudit, completeTaskWithAudit, reconcileAuditTasks } from './team-triage.js';
import { handleUpdateTaskStatus } from '../ui-actions-tasks.js';
import { handleCompleteTask } from '../ui-actions.js';

const setupTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      tier TEXT NOT NULL,
      lines INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      health_score INTEGER NOT NULL DEFAULT 100,
      hazard_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      pillar TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      hazard TEXT NOT NULL,
      directive TEXT NOT NULL
    );
  `);
  initTeamSchema(db);
  return db;
};

test('Verification Gate: refuses completion when architectural hazards remain on disk', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-refuse-'));
  const targetRel = 'src/molecules/m-hazard-sample.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });

  // 260 lines triggers HIGH severity (>= 250 lines in molecule capsule)
  const lines = Array.from({ length: 260 }, (_, i) => `export const val_${i} = ${i};`).join('\n');
  fs.writeFileSync(targetFull, lines, 'utf8');

  const task = createTask(db, {
    title: 'Refactor m-hazard-sample.ts',
    target_path: targetRel,
    tier: 'molecule',
    origin_type: 'audit',
    rule_id: 'MONOLITHIC_FILE_LIMIT',
    violation_snapshot: { healthBefore: 40, hazardCountBefore: 1 }
  });
  assert.ok(task);
  assert.equal(task.origin_type, 'audit');

  const refusal = completeTaskWithAudit(db, task.id, '@test-bot', { cwd: tmpDir });
  assert.ok(refusal);
  assert.equal(refusal.refused, true);
  assert.equal(refusal.verified, false);
  assert.ok(refusal.hazardCount > 0);
  assert.ok(refusal.violations.length > 0);
  assert.match(refusal.message, /Cannot complete task/);

  const persistedTask = getTask(db, task.id);
  assert.notEqual(persistedTask.status, 'done');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Verification Gate: allows completion with force override flag', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-force-'));
  const targetRel = 'src/molecules/m-force-sample.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });

  const lines = Array.from({ length: 260 }, (_, i) => `export const x_${i} = ${i};`).join('\n');
  fs.writeFileSync(targetFull, lines, 'utf8');

  const task = createTask(db, {
    title: 'Refactor m-force-sample.ts',
    target_path: targetRel,
    tier: 'molecule',
    origin_type: 'audit',
    rule_id: 'MONOLITHIC_FILE_LIMIT'
  });

  const completed = completeTaskWithAudit(db, task.id, '@test-bot', { cwd: tmpDir, force: true });
  assert.ok(completed);
  assert.equal(completed.status, 'done');
  assert.equal(completed.result_payload.forced, true);
  assert.equal(completed.diff_receipt.forced, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Verification Gate: allows completion when only non-blocking/deprecated MEDIUM warnings remain', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-nonblocking-'));
  const targetRel = 'src/composables/useSample.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });

  // 6 return properties triggers deprecated HOOK_RETURN_OVERLOAD (MEDIUM severity)
  const code = 'export const useSample = () => { return { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }; };\n';
  fs.writeFileSync(targetFull, code, 'utf8');

  const task = createTask(db, {
    title: 'Modernize useSample.ts',
    target_path: targetRel,
    tier: 'hook',
    origin_type: 'audit',
    rule_id: 'HOOK_RETURN_OVERLOAD',
    violation_snapshot: { healthBefore: 85, hazardCountBefore: 1 }
  });

  // Non-blocking MEDIUM warning should not prevent completion without force
  const completed = completeTaskWithAudit(db, task.id, '@test-bot', { cwd: tmpDir });
  assert.ok(completed);
  assert.equal(completed.status, 'done');
  assert.equal(completed.result_payload.verified, true);
  assert.equal(completed.result_payload.forced, false);
  assert.equal(completed.result_payload.hazardCountAfter, 1);
  assert.equal(completed.diff_receipt.verified, true);
  assert.equal(completed.diff_receipt.forced, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Verification Gate: populates verified diff_receipt upon legitimate resolution', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-receipt-'));
  const targetRel = 'src/molecules/m-clean-sample.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });

  fs.writeFileSync(targetFull, 'export const cleanValue = 42;\n', 'utf8');

  const task = createTask(db, {
    title: 'Resolve hazards in m-clean-sample.ts',
    target_path: targetRel,
    tier: 'molecule',
    origin_type: 'audit',
    rule_id: 'MONOLITHIC_FILE_LIMIT',
    violation_snapshot: { healthBefore: 50, hazardCountBefore: 2 }
  });

  const completed = completeTaskWithAudit(db, task.id, '@test-bot', { cwd: tmpDir });
  assert.ok(completed);
  assert.equal(completed.status, 'done');
  assert.equal(completed.result_payload.verified, true);
  assert.equal(completed.diff_receipt.verified, true);
  assert.equal(completed.diff_receipt.healthBefore, 50);
  assert.equal(completed.diff_receipt.healthAfter, 100);
  assert.equal(completed.diff_receipt.hazardsResolved, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Verification Gate: autoGenerateTasksFromAudit preserves structured provenance', () => {
  const db = setupTestDb();
  db.prepare(`
    INSERT INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count)
    VALUES ('src/molecules/m-prov.ts', 1000, 500, 'molecule', 120, 2500, 60, 1)
  `).run();
  db.prepare(`
    INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
    VALUES ('src/molecules/m-prov.ts', 'MONOLITHIC_FILE_LIMIT', 'HIGH', 'structural', 101, 'Exceeds 100 lines', '1.A')
  `).run();

  const tasks = autoGenerateTasksFromAudit(db, { maxTasks: 5 });
  assert.equal(tasks.length, 1);
  const task = tasks[0];

  assert.equal(task.origin_type, 'audit');
  assert.equal(task.rule_id, 'MONOLITHIC_FILE_LIMIT');
  assert.ok(task.violation_snapshot);
  assert.equal(task.violation_snapshot.healthBefore, 60);
  assert.equal(task.violation_snapshot.hazardCountBefore, 1);
  assert.equal(task.violation_snapshot.rules, 'MONOLITHIC_FILE_LIMIT');
});

test('Verification Gate: UI route intercepts status update to done and refuses unresolved hazards', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-ui-'));
  const targetRel = 'src/molecules/m-ui-gate.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });

  // 260 lines triggers HIGH severity in molecule capsule
  const lines = Array.from({ length: 260 }, (_, i) => `export const u_${i} = ${i};`).join('\n');
  fs.writeFileSync(targetFull, lines, 'utf8');

  const task = createTask(db, {
    title: 'Refactor m-ui-gate.ts',
    target_path: targetRel,
    tier: 'molecule',
    origin_type: 'audit',
    rule_id: 'MONOLITHIC_FILE_LIMIT'
  });

  const updateRes = handleUpdateTaskStatus(db, { taskId: task.id, status: 'done', cwd: tmpDir });
  assert.equal(updateRes.success, false);
  assert.equal(updateRes.refused, true);
  assert.ok(updateRes.hazardCount > 0);

  const dbTask = getTask(db, task.id);
  assert.notEqual(dbTask.status, 'done');

  const completeRes = handleCompleteTask(db, { taskId: task.id }, tmpDir);
  assert.equal(completeRes.success, false);
  assert.equal(completeRes.refused, true);

  const forceRes = handleUpdateTaskStatus(db, { taskId: task.id, status: 'done', force: true, cwd: tmpDir });
  assert.equal(forceRes.success, true);
  assert.equal(forceRes.task.status, 'done');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Verification Gate: reconcileAuditTasks auto-resolves tasks when target files are compliant', () => {
  const db = setupTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-reconcile-'));
  const targetRel = 'src/molecules/m-clean.ts';
  const targetFull = path.join(tmpDir, targetRel);
  fs.mkdirSync(path.dirname(targetFull), { recursive: true });
  fs.writeFileSync(targetFull, 'export const cleanValue = 42;\n');

  const task = createTask(db, {
    title: 'Resolve hazards in src/molecules/m-clean.ts',
    target_path: targetRel,
    origin_type: 'audit'
  });
  assert.equal(task.status, 'queued');

  const resolved = reconcileAuditTasks(db, { cwd: tmpDir });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, task.id);

  const updatedTask = getTask(db, task.id);
  assert.equal(updatedTask.status, 'done');
  assert.equal(updatedTask.result_payload.reconciled, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
