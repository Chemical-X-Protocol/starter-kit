/**
 * #2488: what `chemx team migrate` reports and what a dry run touches. Temp monorepos only;
 * CHEMX_PROJECT_ROOT is deleted so no live .chemx/index.db is opened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { formatMigrateReport } from './team-commands-migrate.js';
import { initTeamSchema } from './team-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const baseReport = (applied) => ({
  dryRun: false, junk: [], junkDropped: false, backups: ['/tmp/b1'], keepIds: 'target', isFirstRun: true, boardRenumbered: 0,
  source: { path: '/tmp/src.db', repo: 'packages/b' }, target: { path: '/tmp/root.db' },
  tables: {}, targets: { byRepo: {}, escapingTargets: [], normalized: 0 }, changedAfterMerge: 0, applied
});

test('the text report prints what was inserted and warns about rows the board kept instead', () => {
  const applied = { tables: { file_leases: { inserted: 1, conflicts: 1, dangling: 0 }, agent_tasks: { inserted: 4, conflicts: 0, dangling: 2 } } };
  const text = formatMigrateReport(baseReport(applied));
  assert.match(text, /applied file_leases: inserted 1, kept board row instead 1, dangling refs dropped 0/);
  assert.match(text, /applied agent_tasks: inserted 4, kept board row instead 0, dangling refs dropped 2/);
  assert.match(text, /WARNING: source rows were not inserted in file_leases/);
  assert.doesNotMatch(text, /not inserted in agent_tasks/);
});

test('a clean merge prints no warning and a dry run prints no applied lines', () => {
  const clean = formatMigrateReport(baseReport({ tables: { agent_tasks: { inserted: 2, conflicts: 0, dangling: 0 } } }));
  assert.doesNotMatch(clean, /WARNING/);
  const dry = formatMigrateReport({ ...baseReport(undefined), dryRun: true, backups: [] });
  assert.doesNotMatch(dry, /applied /);
});

test('--dry-run with no coordination db refuses and creates nothing', () => {
  const repo = buildMonorepo('chemx-dry-');
  try {
    fs.mkdirSync(path.join(repo.pkgB, '.chemx'), { recursive: true });
    const sourcePath = path.join(repo.pkgB, '.chemx', 'index.db');
    const source = new DatabaseSync(sourcePath);
    initTeamSchema(source);
    source.close();
    const report = runTeamCli(['migrate', '--from', sourcePath, '--dry-run'], false, repo.root);
    assert.equal(report.ok, false);
    assert.match(report.error, /No coordination db/);
    assert.equal(fs.existsSync(path.join(repo.root, '.chemx')), false, 'the root got no .chemx dir');
  } finally {
    repo.cleanup();
  }
});
