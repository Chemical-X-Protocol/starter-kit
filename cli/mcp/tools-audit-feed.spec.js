import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHEMX_TEST = '1';

import { handleChemxAuditFeed, FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT } from './tools-audit-feed.js';
import { parseCommand, ACTION_NAMES } from './tools.js';
import { ACTION_HELP } from './help.js';

const run = (i, scope) => ({
  id: `r${i}`, timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), scope, isPartial: false,
  health: { score: 80, grade: 'B' }, metrics: { scannedFiles: 1 }, violations: { total: 0 },
  pillars: { 'Naming Conventions': { status: 'PASSED', violations: 0, critical: 0 } }
});

const withProject = (count, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-mcp-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.writeFileSync(path.join(root, '.chemx', 'history.json'), JSON.stringify(Array.from({ length: count }, (_, i) => run(i, i % 2 ? 'apps/a' : '.'))));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('audit_feed: returns the newest rows with totals, and says when it cut', () => {
  withProject(FEED_DEFAULT_LIMIT + 10, (root) => {
    const result = handleChemxAuditFeed({ view: 'history' }, root);
    assert.strictEqual(result.view, 'history');
    assert.strictEqual(result.total, FEED_DEFAULT_LIMIT + 10);
    assert.strictEqual(result.returned, FEED_DEFAULT_LIMIT);
    assert.strictEqual(result.cut, true);
    assert.strictEqual(result.rows.at(-1).runId, `r${FEED_DEFAULT_LIMIT + 9}`, 'the newest run is kept');
  });
});

test('audit_feed: limit is capped, filters pass through', () => {
  withProject(10, (root) => {
    const all = handleChemxAuditFeed({ view: 'history', limit: FEED_MAX_LIMIT + 1000 }, root);
    assert.strictEqual(all.returned, 10);
    assert.strictEqual(all.cut, false);
    const scoped = handleChemxAuditFeed({ view: 'pillars', scope: 'apps' }, root);
    assert.strictEqual(scoped.total, 5);
    assert.ok(scoped.rows.every((r) => r.scope === 'apps/a'));
    const scopes = handleChemxAuditFeed({ view: 'scopes' }, root);
    assert.deepStrictEqual(scopes.rows.map((r) => r.scope), ['.', 'apps/a']);
  });
});

test('audit_feed: unknown view is refused with the list of views', () => {
  withProject(1, (root) => {
    assert.throws(() => handleChemxAuditFeed({ view: 'bogus' }, root), /history, pillars, scopes/);
  });
});

test('audit_feed: the CLI string form parses to audit_feed, and plain audit still audits', () => {
  const parsed = parseCommand('audit --feed=scopes --scope=apps --limit=5', {});
  assert.strictEqual(parsed.action, 'audit_feed');
  withProject(4, (root) => {
    const result = handleChemxAuditFeed(parsed.params, root);
    assert.strictEqual(result.view, 'scopes');
    assert.deepStrictEqual(result.rows.map((r) => r.scope), ['apps/a']);
  });
  assert.strictEqual(parseCommand('audit src', {}).action, 'audit');
});

test('audit_feed: registered with help, and not a mutating action', async () => {
  assert.ok(ACTION_NAMES.includes('audit_feed'));
  assert.match(ACTION_HELP.audit_feed, /read-only/);
  const { readFileSync } = fs;
  const callScope = readFileSync(new URL('./call-scope.js', import.meta.url), 'utf-8');
  const mutatingLine = callScope.split('\n').find((line) => line.startsWith('const MUTATING_ACTIONS'));
  assert.doesNotMatch(mutatingLine, /audit_feed/);
});
