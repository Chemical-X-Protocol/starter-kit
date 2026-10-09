import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHEMX_TEST = '1';

import { FEED_VIEWS, historyRows, pillarRows, scopeRows, readAuditFeed } from './feed.js';

const snapshot = (overrides = {}) => ({
  id: 'audit-1',
  timestamp: '2026-10-09T08:00:00.000Z',
  scope: '.',
  isPartial: false,
  ruleset: 4,
  scoreModel: 2,
  health: { score: 72, grade: 'C', label: 'x' },
  aiSlop: { score: 90, grade: 'A', label: 'y', violationsCount: 1 },
  metrics: { scannedFiles: 120, totalLoc: 9000 },
  violations: { total: 10, critical: 1, high: 2, medium: 3, low: 4 },
  monoliths: { total: 2 },
  pillars: {
    'Control Flow & Boolean Logic': { status: 'FAILED', violations: 6, critical: 1 },
    'Naming Conventions': { status: 'PASSED', violations: 0, critical: 0 }
  },
  ...overrides
});

const legacy = { id: 'audit-0', timestamp: '2026-09-11T06:22:05.383Z', health: { score: 0, grade: 'F' }, metrics: { scannedFiles: 826 }, violations: { total: 501 }, pillars: {} };

test('historyRows: flattens a snapshot into one row with every dashboard column', () => {
  const [row] = historyRows([snapshot()]);
  assert.deepStrictEqual(row, {
    runId: 'audit-1', timestamp: '2026-10-09T08:00:00.000Z', scope: '.', isPartial: false, ruleset: 4, scoreModel: 2,
    healthScore: 72, grade: 'C', aiSlopScore: 90, aiSlopGrade: 'A', files: 120, loc: 9000,
    violations: 10, critical: 1, high: 2, medium: 3, low: 4, monoliths: 2
  });
});

test('historyRows: legacy entries without scope come out as scope null, missing numbers as null', () => {
  const [row] = historyRows([legacy]);
  assert.strictEqual(row.scope, null);
  assert.strictEqual(row.isPartial, false);
  assert.strictEqual(row.ruleset, null);
  assert.strictEqual(row.critical, null);
  assert.strictEqual(row.violations, 501);
});

test('historyRows: filters by scope prefix, since and fullOnly', () => {
  const runs = [
    snapshot({ id: 'r1', scope: 'apps/a', timestamp: '2026-10-01T00:00:00.000Z' }),
    snapshot({ id: 'r2', scope: 'apps/a', isPartial: true, timestamp: '2026-10-05T00:00:00.000Z' }),
    snapshot({ id: 'r3', scope: 'appsx', timestamp: '2026-10-06T00:00:00.000Z' }),
    snapshot({ id: 'r4', scope: 'apps', timestamp: '2026-10-07T00:00:00.000Z' }),
    legacy
  ];
  const ids = (rows) => rows.map((r) => r.runId);
  assert.deepStrictEqual(ids(historyRows(runs, { scope: 'apps' })), ['r1', 'r2', 'r4'], 'prefix matches whole path segments only');
  assert.deepStrictEqual(ids(historyRows(runs, { since: '2026-10-05' })), ['r2', 'r3', 'r4']);
  assert.deepStrictEqual(ids(historyRows(runs, { scope: 'apps', fullOnly: true })), ['r1', 'r4']);
});

test('pillarRows: one row per run per pillar, carrying the run scope', () => {
  const rows = pillarRows([snapshot(), legacy]);
  assert.deepStrictEqual(rows, [
    { runId: 'audit-1', timestamp: '2026-10-09T08:00:00.000Z', scope: '.', isPartial: false, ruleset: 4, pillar: 'Control Flow & Boolean Logic', status: 'FAILED', violations: 6, critical: 1 },
    { runId: 'audit-1', timestamp: '2026-10-09T08:00:00.000Z', scope: '.', isPartial: false, ruleset: 4, pillar: 'Naming Conventions', status: 'PASSED', violations: 0, critical: 0 }
  ]);
});

test('scopeRows: one row per scope from the newest full run, joined with its status gate', () => {
  const history = [
    snapshot({ id: 'old', scope: 'apps/a', health: { score: 40, grade: 'F' }, timestamp: '2026-10-01T00:00:00.000Z' }),
    snapshot({ id: 'new', scope: 'apps/a', health: { score: 60, grade: 'D' }, timestamp: '2026-10-02T00:00:00.000Z' }),
    snapshot({ id: 'partial', scope: 'apps/a', isPartial: true, health: { score: 100, grade: 'A+' }, timestamp: '2026-10-03T00:00:00.000Z' }),
    snapshot({ id: 'root', scope: '.', timestamp: '2026-10-02T00:00:00.000Z' }),
    legacy
  ];
  const status = {
    version: 1,
    latestScope: 'apps/a',
    scopes: {
      'apps/a': { updatedAt: '2026-10-03T00:00:00.000Z', gate: { isPassing: false, basis: 'severity', regressions: 2 }, hazards: { critical: 1, high: 0, medium: 0, low: 0 }, coverage: { astPct: 97 }, isPartialScan: true },
      'apps/b': { updatedAt: '2026-10-04T00:00:00.000Z', health: { score: 88, grade: 'B' }, gate: { isPassing: true, basis: 'severity', regressions: 0 }, hazards: { critical: 0, high: 1, medium: 0, low: 0 } }
    }
  };
  const rows = scopeRows(history, status);
  assert.deepStrictEqual(rows.map((r) => r.scope), ['.', 'apps/a', 'apps/b'], 'sorted by scope; legacy runs without scope are left out');

  const a = rows.find((r) => r.scope === 'apps/a');
  assert.strictEqual(a.runId, 'new', 'metrics come from the newest full run, not the later partial one');
  assert.strictEqual(a.healthScore, 60);
  assert.deepStrictEqual([a.aiSlopScore, a.medium, a.low, a.monoliths], [90, 3, 4, 2], 'severity breakdown and slop come from the same full run');
  assert.strictEqual(a.runs, 3);
  assert.strictEqual(a.gatePassing, false);
  assert.strictEqual(a.gateRegressions, 2);
  assert.strictEqual(a.statusUpdatedAt, '2026-10-03T00:00:00.000Z');
  assert.strictEqual(a.statusIsPartial, true);

  const root = rows.find((r) => r.scope === '.');
  assert.strictEqual(root.gatePassing, null, 'no status entry means no gate verdict, not a pass');

  const b = rows.find((r) => r.scope === 'apps/b');
  assert.strictEqual(b.runId, null, 'a status-only scope still appears, without run metrics');
  assert.strictEqual(b.healthScore, 88, 'falls back to the status health when there is no full run');
  assert.strictEqual(b.gatePassing, true);
});

test('readAuditFeed: reads history.json and status.json from a project and rejects unknown views', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-'));
  try {
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.writeFileSync(path.join(root, '.chemx', 'history.json'), JSON.stringify([snapshot()]));
    fs.writeFileSync(path.join(root, '.chemx', 'status.json'), JSON.stringify({ version: 1, latestScope: '.', scopes: { '.': { updatedAt: 'x', gate: { isPassing: true } } } }));
    assert.deepStrictEqual(FEED_VIEWS, ['history', 'pillars', 'scopes']);
    assert.strictEqual(readAuditFeed('history', { cwd: root }).length, 1);
    assert.strictEqual(readAuditFeed('pillars', { cwd: root }).length, 2);
    assert.strictEqual(readAuditFeed('scopes', { cwd: root })[0].gatePassing, true);
    assert.throws(() => readAuditFeed('bogus', { cwd: root }), /history, pillars, scopes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readAuditFeed: a project with no audits yet gives empty rows, not an error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-empty-'));
  try {
    for (const view of FEED_VIEWS) assert.deepStrictEqual(readAuditFeed(view, { cwd: root }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
