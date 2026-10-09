/**
 * Swarm spec hygiene (finding multiprocess-spec-cwd-dependent, plus the temp-project rule):
 * team and studio specs run from any cwd and never open the project's own .chemx/index.db,
 * which in the kit is the shared task backlog.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));

const listSpecs = (dir, accept) => fs.readdirSync(dir)
  .filter((name) => name.endsWith('.spec.js') && accept(name))
  .map((name) => path.join(dir, name));

const SWARM_SPECS = [
  ...listSpecs(path.join(CLI_DIR, 'team'), (name) => name !== 'team-spec-hygiene.spec.js'),
  ...listSpecs(CLI_DIR, (name) => name.startsWith('ui')),
  path.join(CLI_DIR, 'mcp', 'tools-project.spec.js')
];

const findOffenders = (files, patterns) => files.flatMap((file) => {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  return lines.flatMap((line, index) => {
    const hit = patterns.find(({ test: matches }) => matches(line));
    return hit ? [`${path.relative(CLI_DIR, file)}:${index + 1} ${hit.why}`] : [];
  });
});

test('spec hygiene: child-process imports resolve from the spec file, not process.cwd()', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => /path\.resolve\(['"]cli\//.test(line), why: 'cwd-relative module path; use new URL(..., import.meta.url)' }
  ]);
  assert.deepEqual(offenders, []);
});

test('spec hygiene: source-tree scans resolve from the spec file, not process.cwd()', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => /path\.resolve\(process\.cwd\(\), ['"](cli|src)/.test(line), why: 'cwd-relative source dir; resolve from import.meta.url' }
  ]);
  assert.deepEqual(offenders, []);
});

// Every spec under cli/ that opens an on-disk index db (which carries the team tables).
const listAllSpecs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  const isSkippedDir = entry.name === 'node_modules' || entry.name.startsWith('.');
  if (isSkippedDir) return [];
  if (entry.isDirectory()) return listAllSpecs(full);
  const isSpec = entry.name.endsWith('.spec.js');
  return isSpec ? [full] : [];
});

const OPENS_DISK_DB = [
  /openIndexDb\((?!\s*['"]:memory:['"])/,
  /handleChemx(Team|Project)\w*\(/,
  /(startUiServer|createUiServer)\(/
];

const opensTeamDb = (source) => OPENS_DISK_DB.some((pattern) => pattern.test(source));
const isolatesCwd = (source) => source.includes('mkdtemp');
const dropsProjectRootEnv = (source) => /delete\s+[\w.]*\.?CHEMX_PROJECT_ROOT\b/.test(source);

// Specs that opened a team db before this rule existed and still lack the env guard. The list
// only shrinks: a fixed spec must be removed from it (the ratchet test below fails otherwise).
// Removing CHEMX_PROJECT_ROOT for `chemx test` children (build/executor.js) already covers
// them under chemx; the guard matters for a bare `node --test` from a shell that exports it.
const LEGACY_UNGUARDED = new Set([
  'audit-triage.spec.js', 'db-project-stamp-message.spec.js', 'db-project-stamp.spec.js',
  'friction-fixes.spec.js', 'generator.spec.js', 'mcp/server.spec.js', 'patch-safety.spec.js',
  'patcher.spec.js', 'path-traversal.spec.js', 'search-bulletproof.spec.js', 'search-index-busy.spec.js',
  'search-scope.spec.js', 'search-sync.spec.js', 'search.spec.js', 'spot-check-fixes.spec.js',
  'team/lock-decision-parity.spec.js', 'team/task-detail-card.spec.js', 'team/task-list-view.spec.js',
  'team/task-tier.spec.js', 'team/team-adversarial-locks.spec.js', 'team/team-lease-safety.spec.js',
  'team/team-lock-exclusion.spec.js', 'team/team-mailbox.spec.js', 'team/team-memory.spec.js',
  'team/team-multiprocess-concurrency.spec.js', 'team/team-needs.spec.js', 'team/team-task-ownership.spec.js',
  'team/team-tasks-asana.spec.js', 'team/team-tasks-hierarchy.spec.js', 'team/team-telemetry-source.spec.js',
  'team/team-telemetry-unknown.spec.js', 'team/team.spec.js', 'ui-canonical-routes.spec.js',
  'ui-direct-routes.spec.js', 'ui-e2e-verification.spec.js', 'ui-filetree.spec.js', 'ui-security.spec.js',
  'ui-sql-guard.spec.js', 'ui-sse.spec.js', 'ui-workbench-dbstudio.spec.js', 'ui.spec.js'
]);

const findUnisolatedTeamDbSpecs = () => listAllSpecs(CLI_DIR)
  .filter((file) => path.basename(file) !== 'team-spec-hygiene.spec.js')
  .filter((file) => opensTeamDb(fs.readFileSync(file, 'utf-8')))
  .flatMap((file) => {
    const source = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(CLI_DIR, file).split(path.sep).join('/');
    const missing = [
      isolatesCwd(source) ? null : 'no temp project (mkdtemp)',
      dropsProjectRootEnv(source) ? null : 'does not delete CHEMX_PROJECT_ROOT'
    ].filter(Boolean);
    const hasGap = missing.length > 0;
    return hasGap ? [{ rel, missing }] : [];
  });

test('spec hygiene: every spec that opens a team db isolates its cwd and drops CHEMX_PROJECT_ROOT', () => {
  const offenders = findUnisolatedTeamDbSpecs()
    .filter(({ rel }) => !LEGACY_UNGUARDED.has(rel))
    .map(({ rel, missing }) => `${rel}: ${missing.join(', ')}`);
  assert.deepEqual(offenders, []);
});

test('spec hygiene: the legacy unguarded list only names specs that still need the guard', () => {
  const stillUnguarded = new Set(findUnisolatedTeamDbSpecs().map(({ rel }) => rel));
  const fixed = [...LEGACY_UNGUARDED].filter((rel) => !stillUnguarded.has(rel));
  assert.deepEqual(fixed, [], 'remove these from LEGACY_UNGUARDED');
});

test('spec hygiene: swarm specs use a temp project, never the cwd project db', () => {
  const offenders = findOffenders(SWARM_SPECS, [
    { test: (line) => line.includes('openIndexDb(process.cwd())'), why: 'opens the cwd project db' },
    { test: (line) => line.includes('openIndexDb()'), why: 'opens the default (cwd) project db' },
    { test: (line) => /startUiServer\(\{ port: 0 \}\)/.test(line), why: 'studio server defaults to the cwd project' },
    { test: (line) => /(startUiServer|createUiServer)\(.*process\.cwd\(\)/.test(line), why: 'studio server on the cwd project' }
  ]);
  assert.deepEqual(offenders, []);
});
