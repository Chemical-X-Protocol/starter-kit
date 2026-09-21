import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runAudit } from './audit.js';

test('audit: options.stage tags the report as draft or strict', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-audit-stage');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // Sample file with an inline multi-clause boolean (MEDIUM severity)
  const code = `export const check = (a: number, b: number, c: number) => {
  if (a > 0 && b > 0 && c > 0) return true;
  return false;
};`;
  fs.writeFileSync(path.join(tmpDir, 'sample.ts'), code, 'utf-8');

  const draftReport = runAudit(tmpDir, { stage: 'draft' });
  assert.strictEqual(draftReport.stage, 'draft');
  assert.ok(draftReport.totalViolations > 0);

  const hasCritical = draftReport.violations.some((v) => v.severity === 'CRITICAL');
  assert.strictEqual(hasCritical, false, 'Should have 0 critical violations');

  const strictReport = runAudit(tmpDir, { stage: 'strict' });
  assert.strictEqual(strictReport.stage, 'strict');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
