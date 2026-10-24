import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createCoverageCollector, recordFileCoverage, summarizeCoverage } from './coverage.js';
import { buildAuditSummary } from './audit-summary.js';
import { buildScopeStatus } from './status-file.js';
import { formatPlainAuditSummary } from './audit-plain.js';
import { auditCodeDetailed, auditCode } from './rules.js';

const collectorWithTwoLanguages = () => {
  const collector = createCoverageCollector();
  recordFileCoverage(collector, { relativePath: 'a.ts', kind: 'ast', language: 'typescript' });
  recordFileCoverage(collector, { relativePath: 'b.ts', kind: 'parse-error', language: 'typescript', reason: 'x' });
  recordFileCoverage(collector, { relativePath: 'c.php', kind: 'text-only', language: 'php', reason: 'y' });
  recordFileCoverage(collector, { relativePath: 'd.txt', kind: 'ast' });
  return collector;
};

test('summarizeCoverage reports byLanguage counts', () => {
  const { byLanguage } = summarizeCoverage(collectorWithTwoLanguages());
  assert.deepEqual(byLanguage, {
    typescript: { files: 2, ast: 1, textOnly: 0, parseErrors: 1 },
    php: { files: 1, ast: 0, textOnly: 1, parseErrors: 0 }
  });
});

test('the card summary, status file and plain card carry byLanguage', () => {
  const coverage = summarizeCoverage(collectorWithTwoLanguages());
  const report = { coverage, violations: [], health: { score: 90, grade: 'A' }, metrics: { scannedFiles: 4, totalLoc: 10 }, contextAnalysis: {} };
  const summary = buildAuditSummary(report, { projectRoot: os.tmpdir(), scope: 'all' });
  assert.deepEqual(summary.coverage.byLanguage, coverage.byLanguage);
  assert.deepEqual(buildScopeStatus(report).coverage.byLanguage, coverage.byLanguage);
  const card = formatPlainAuditSummary(summary);
  assert.match(card, /php: 1 files/);
  assert.match(card, /typescript: 2 files/);
});

test('the plain card prints no language lines for a single language', () => {
  const collector = createCoverageCollector();
  recordFileCoverage(collector, { relativePath: 'a.ts', kind: 'ast', language: 'typescript' });
  const summary = { scope: 's', files: 1, loc: 1, tokens: { estimate: 1 }, health: { grade: 'A', score: 1 }, hazards: { critical: 0, highMedium: 0, low: 0 }, gate: { passing: null }, coverage: summarizeCoverage(collector) };
  assert.doesNotMatch(formatPlainAuditSummary(summary), /typescript:/);
});

test('auditCodeDetailed returns ast coverage for a parseable .ts file', () => {
  const code = 'export const a = 1;\n';
  const { violations, coverage } = auditCodeDetailed(code, 'src/a.ts', 'src/a.ts', {});
  assert.equal(coverage.kind, 'ast');
  assert.equal(coverage.language, 'typescript');
  assert.deepEqual(violations, auditCode(code, 'src/a.ts', 'src/a.ts', {}));
});

test('auditCodeDetailed returns parse-error coverage for an unparseable .ts file', () => {
  const { coverage } = auditCodeDetailed('export const = ;;{\n', 'src/b.ts', 'src/b.ts', {});
  assert.equal(coverage.kind, 'parse-error');
  assert.ok(coverage.reason);
});

test('auditCodeDetailed in fast mode reports text-only with a reason', () => {
  const { coverage } = auditCodeDetailed('export const a = 1;\n', 'src/a.ts', 'src/a.ts', { fast: true });
  assert.equal(coverage.kind, 'text-only');
  assert.match(coverage.reason, /fast/);
});
