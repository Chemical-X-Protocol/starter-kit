import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.CHEMX_TEST = '1';

import { parseFeedArgs, runAuditFeedCommand } from './cmd-audit-feed.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const run = (id, scope, timestamp, extra = {}) => ({
  id, timestamp, scope, isPartial: false, ruleset: 4, scoreModel: 2,
  health: { score: 80, grade: 'B' }, aiSlop: { score: 100, grade: 'A+' },
  metrics: { scannedFiles: 10, totalLoc: 500 }, violations: { total: 3, critical: 1, high: 1, medium: 1, low: 0 },
  monoliths: { total: 0 }, pillars: { 'Naming Conventions': { status: 'WARN', violations: 3, critical: 1 } },
  ...extra
});

const withProject = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-cmd-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  const history = Array.from({ length: 25 }, (_, i) => run(`r${i}`, i % 2 ? 'apps/a' : '.', new Date(Date.UTC(2026, 9, 1 + i)).toISOString()));
  fs.writeFileSync(path.join(root, '.chemx', 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(root, '.chemx', 'status.json'), JSON.stringify({ version: 1, latestScope: '.', scopes: { '.': { updatedAt: '2026-10-25T00:00:00.000Z', gate: { isPassing: false, basis: 'ratchet', regressions: 1 } } } }));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { write: (s) => out.push(s), writeError: (s) => err.push(s) } };
};

test('parseFeedArgs: bare --feed means history; flags are read', () => {
  assert.deepStrictEqual(parseFeedArgs(['--feed']), { view: 'history', scope: undefined, since: undefined, fullOnly: false, isJson: false, limit: null });
  assert.deepStrictEqual(
    parseFeedArgs(['--feed=scopes', '--scope=apps', '--since=2026-10-01', '--full-only', '--json', '--limit=5']),
    { view: 'scopes', scope: 'apps', since: '2026-10-01', fullOnly: true, isJson: true, limit: 5 }
  );
});

test('runAuditFeedCommand --json prints a bare array of every matching row', () => {
  withProject((root) => {
    const { out, io } = capture();
    const result = runAuditFeedCommand(['--feed=history', '--json', '--scope=apps'], { cwd: root, ...io });
    assert.strictEqual(result.code, 0);
    const rows = JSON.parse(out.join(''));
    assert.strictEqual(rows.length, 12);
    assert.ok(rows.every((r) => r.scope === 'apps/a'));
  });
});

test('runAuditFeedCommand table: newest 20 rows by default, says how many were left out', () => {
  withProject((root) => {
    const { out, io } = capture();
    runAuditFeedCommand(['--feed'], { cwd: root, ...io });
    const text = out.join('');
    assert.match(text, /scope/);
    assert.match(text, /2026-10-25/, 'newest run is shown');
    assert.doesNotMatch(text, /2026-10-01/, 'oldest runs past the cap are left out');
    assert.match(text, /5 older rows not shown/);
    assert.doesNotMatch(text, /\x1b\[/, 'no ANSI escapes');
  });
});

test('runAuditFeedCommand scopes table shows the gate verdict', () => {
  withProject((root) => {
    const { out, io } = capture();
    runAuditFeedCommand(['--feed=scopes'], { cwd: root, ...io });
    const text = out.join('');
    assert.match(text, /apps\/a/);
    assert.match(text, /fail/);
  });
});

test('runAuditFeedCommand: unknown view exits 2 and lists the views', () => {
  withProject((root) => {
    const { err, io } = capture();
    const result = runAuditFeedCommand(['--feed=bogus'], { cwd: root, ...io });
    assert.strictEqual(result.code, 2);
    assert.match(err.join(''), /history, pillars, scopes/);
  });
});

test('chemx audit --feed goes through the router and never runs an audit', () => {
  withProject((root) => {
    const historyPath = path.join(root, '.chemx', 'history.json');
    const before = fs.readFileSync(historyPath, 'utf-8');
    const stdout = execFileSync(process.execPath, [CLI, 'audit', '--feed=pillars', '--json', '--limit=2'], {
      cwd: root, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '' }
    });
    const rows = JSON.parse(stdout);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1].pillar, 'Naming Conventions');
    assert.strictEqual(fs.readFileSync(historyPath, 'utf-8'), before, 'history.json is untouched');
  });
});
