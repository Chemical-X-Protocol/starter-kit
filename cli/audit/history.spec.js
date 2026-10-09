import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHEMX_TEST = '1';

import {
  saveAuditSnapshot,
  getAuditHistory,
  trimAuditHistory,
  HISTORY_PER_SCOPE,
  HISTORY_TOTAL
} from './history.js';

const makeReport = (score = 80, scannedFiles = 10) => ({
  metrics: { scannedFiles, totalLoc: scannedFiles * 10, avgLoc: 10, moleculeCount: 0, moleculeCompliantCount: 0, moleculeCompliantPct: 100, hookCount: 0 },
  health: { score, grade: 'B', label: 'Test' },
  violations: [],
  pillars: {}
});

const withTempProject = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-history-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const entry = (scope, i) => ({ id: `audit-${scope}-${i}`, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(), scope });

test('saveAuditSnapshot: records the audited scope and whether the scan was partial', () => {
  withTempProject((root) => {
    saveAuditSnapshot(makeReport(), root, { scope: 'apps/youmeos', isPartial: true });
    const [saved] = getAuditHistory(root);
    assert.strictEqual(saved.scope, 'apps/youmeos');
    assert.strictEqual(saved.isPartial, true);
  });
});

test('saveAuditSnapshot: a run without scope info is stored with scope null', () => {
  withTempProject((root) => {
    saveAuditSnapshot(makeReport(), root);
    const [saved] = getAuditHistory(root);
    assert.strictEqual(saved.scope, null);
    assert.strictEqual(saved.isPartial, false);
  });
});

test('trimAuditHistory: keeps the newest runs per scope, so one scope cannot evict another', () => {
  const rootRuns = Array.from({ length: 5 }, (_, i) => entry('.', i));
  const subRuns = Array.from({ length: HISTORY_PER_SCOPE + 20 }, (_, i) => entry('apps/a', 100 + i));
  const trimmed = trimAuditHistory([...rootRuns, ...subRuns]);

  assert.strictEqual(trimmed.filter((s) => s.scope === '.').length, 5);
  const kept = trimmed.filter((s) => s.scope === 'apps/a');
  assert.strictEqual(kept.length, HISTORY_PER_SCOPE);
  assert.strictEqual(kept[0].id, `audit-apps/a-${100 + 20}`, 'the oldest runs of the busy scope are the ones dropped');
  assert.deepStrictEqual(trimmed.map((s) => s.id), [...rootRuns, ...kept].map((s) => s.id), 'order is preserved');
});

test('trimAuditHistory: legacy entries without a scope share one bucket', () => {
  const legacy = Array.from({ length: HISTORY_PER_SCOPE + 3 }, (_, i) => ({ id: `legacy-${i}`, timestamp: entry('x', i).timestamp }));
  const trimmed = trimAuditHistory([...legacy, entry('.', 999)]);
  assert.strictEqual(trimmed.filter((s) => s.scope === undefined).length, HISTORY_PER_SCOPE);
  assert.ok(trimmed.some((s) => s.scope === '.'));
});

test('trimAuditHistory: an overall cap still bounds the file across many scopes', () => {
  const scopes = Math.ceil(HISTORY_TOTAL / HISTORY_PER_SCOPE) + 2;
  const history = [];
  for (let s = 0; s < scopes; s++) {
    for (let i = 0; i < HISTORY_PER_SCOPE; i++) history.push(entry(`apps/s${s}`, s * 1000 + i));
  }
  const trimmed = trimAuditHistory(history);
  assert.strictEqual(trimmed.length, HISTORY_TOTAL);
  assert.strictEqual(trimmed[trimmed.length - 1].id, history[history.length - 1].id, 'the newest run survives');
});

test('saveAuditSnapshot: duplicate detection compares against the same scope only', () => {
  withTempProject((root) => {
    saveAuditSnapshot(makeReport(), root, { scope: 'apps/a' });
    saveAuditSnapshot(makeReport(), root, { scope: 'apps/b' });
    saveAuditSnapshot(makeReport(), root, { scope: 'apps/a' });
    const scopes = getAuditHistory(root).map((s) => s.scope);
    assert.deepStrictEqual(scopes, ['apps/a', 'apps/b'], 'the repeat of apps/a within 5s is deduplicated, apps/b is kept');
  });
});
