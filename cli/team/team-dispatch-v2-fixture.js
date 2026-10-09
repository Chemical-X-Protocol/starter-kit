/**
 * Test fixture for the dispatch run specs (#2494): an in-memory team db with tasks of each tier,
 * dependencies, a shared target, a leased target, a dirty target, an untargeted task and one that
 * leaves the root, plus peer claims and leases. Every disk and clock input is injected.
 */
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';

export const FIXTURE_ROOT = '/work/kit';
export const FIXTURE_NOW = 1_000_000;

const insertTask = (db, fields) => {
  const row = {
    title: 'Task', description: '', target_path: null, status: 'queued', priority: 2, assigned_agent_id: null,
    dependencies: '[]', violation_snapshot: '{}', needs: null, ...fields
  };
  db.prepare(`
    INSERT INTO agent_tasks (id, title, description, target_path, status, priority, assigned_agent_id, dependencies, violation_snapshot, needs, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `).run(row.id, row.title, row.description, row.target_path, row.status, row.priority, row.assigned_agent_id, row.dependencies, row.violation_snapshot, row.needs);
};

/** The fixture db. Ready after screening: #1 #2 #3 #4 #10; #2 and #3 share cli/b.js. */
export const makeFixtureDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const snapshot = JSON.stringify({ rules: 'CONTROL_FLOW_INLINE_BOOLEAN', violationLines: '12', hazardCountBefore: 3 });
  const tasks = [
    { id: 1, title: 'Rename the helper (mechanical)', target_path: 'cli/a.js', needs: 'light' },
    { id: 2, title: 'Fix the inline boolean', target_path: 'cli/b.js', needs: 'light', violation_snapshot: snapshot },
    { id: 3, title: 'Add a flag', description: 'Add --flag to the command.\nAcceptance: --flag works and is documented.', target_path: 'cli/b.js', needs: 'standard' },
    { id: 4, title: 'Split the module', target_path: 'cli/c.js', needs: 'deep' },
    { id: 5, title: 'Waits on #99', target_path: 'cli/d.js', needs: 'standard', dependencies: '[99]' },
    { id: 6, title: 'Leased target', target_path: 'cli/locked.js', needs: 'light' },
    { id: 7, title: 'Dirty target', target_path: 'cli/dirty.js', needs: 'light' },
    { id: 8, title: 'No target yet', needs: 'light' },
    { id: 9, title: 'Outside the root', target_path: '../other/x.js', needs: 'light' },
    { id: 10, title: 'After #11', target_path: 'cli/e.js', needs: 'standard', dependencies: '[11]' },
    { id: 11, title: 'Finished dependency', target_path: 'cli/f.js', status: 'done', needs: 'light' },
    { id: 99, title: 'Peer work', target_path: 'cli/p.js', status: 'in_progress', assigned_agent_id: '@peer', needs: 'standard' }
  ];
  for (const task of tasks) insertTask(db, task);
  const lease = db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid) VALUES (?, ?, ?, ?, ?, 0)');
  lease.run('cli/locked.js', '@peer', 1, FIXTURE_NOW + 60_000, '#99');
  lease.run('cli/old.js', '@gone', 1, FIXTURE_NOW - 1, '#1');
  return db;
};

/** buildRunPlan options that keep the fixture off the disk and the clock. */
export const fixtureOptions = (overrides = {}) => ({
  root: FIXTURE_ROOT,
  agentId: '@disp',
  now: FIXTURE_NOW,
  routing: null,
  maxAgents: 2,
  runName: 'fixture-run',
  goal: 'make chemx dependable',
  leaseCheck: (file) => (file === 'cli/locked.js' ? { lockedBy: '@peer', purpose: '#99' } : null),
  dirtyFiles: new Set(['cli/dirty.js']),
  ownsFile: () => false,
  ...overrides
});
