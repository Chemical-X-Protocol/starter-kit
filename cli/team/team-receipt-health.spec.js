/**
 * Task receipts score health with the audit's score model (severity-weighted),
 * not 100 - 15 per hazard (review of #1532: 43 LOW/MEDIUM hazards read as 0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';
import { auditFile } from '../audit.js';
import { calculateMolecularHealthScore, SCORE_MODEL } from '../audit/metrics.js';

const FILES_TABLE = `CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tier TEXT NOT NULL,
  lines INTEGER NOT NULL, chars INTEGER NOT NULL, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);`;

test('receipt healthAfter uses the severity-weighted score model', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(FILES_TABLE);
  initTeamSchema(db);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-receipt-health-'));
  try {
    const rel = 'src/flags.ts';
    fs.mkdirSync(path.join(root, 'src'));
    const body = Array.from({ length: 8 }, (_, i) => `export const f${i} = (a, b) => { if (a > b) return ${i}; return 0; };`).join('\n');
    fs.writeFileSync(path.join(root, rel), `${body}\n`);
    const hazards = auditFile(path.join(root, rel), rel, { cwd: root });
    assert.ok(hazards.length >= 7, `fixture should carry many LOW hazards, got ${hazards.length}`);
    assert.ok(hazards.every((v) => v.severity === 'LOW' || v.severity === 'MEDIUM'));

    const task = createTask(db, { title: 'flags', target_path: rel, origin_type: 'audit', violation_snapshot: { healthBefore: 50, hazardCountBefore: 1 } });
    const completed = completeTaskWithAudit(db, task.id, '@test-bot', { cwd: root });
    const expected = calculateMolecularHealthScore(hazards, 1).score;
    assert.equal(completed.result_payload.healthAfter, expected);
    assert.equal(completed.result_payload.healthModel, SCORE_MODEL);
    assert.ok(completed.result_payload.healthAfter > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
