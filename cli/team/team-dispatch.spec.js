/**
 * chemx team dispatch core (#2005): read-only task selection on a temp db, needs fallback,
 * model routing defaults and config override, and live-lease skips through findForeignLease.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { RULE_REGISTRY } from '../audit/rules-registry.js';
import {
  DEFAULT_MODEL_ROUTING,
  buildDispatchPlan,
  loadModelRouting,
  resolveTaskNeeds,
  routeModel,
  selectDispatchTasks
} from './team-dispatch.js';

const DEEP_RULE = Object.entries(RULE_REGISTRY).find(([, rule]) => rule.needs === 'deep')?.[0];

const makeRoot = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
  return root;
};

const openDb = (dbPath = ':memory:') => {
  const db = new DatabaseSync(dbPath);
  initTeamSchema(db);
  return db;
};

const insertTask = (db, fields) => {
  const now = Date.now();
  const row = { title: 'Task', description: '', target_path: null, status: 'queued', priority: 2, assigned_agent_id: null, parent_id: null, rule_id: '', needs: null, ...fields };
  const result = db.prepare(`
    INSERT INTO agent_tasks (title, description, target_path, status, priority, assigned_agent_id, parent_id, rule_id, needs, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.title, row.description, row.target_path, row.status, row.priority, row.assigned_agent_id, row.parent_id, row.rule_id, row.needs, now, now);
  return Number(result.lastInsertRowid);
};

const ids = (tasks) => tasks.map((task) => task.id);

test('selectDispatchTasks: queued, unassigned leaf tasks in priority order', () => {
  const db = openDb();
  const parent = insertTask(db, { title: 'Group' });
  const child = insertTask(db, { target_path: 'cli/a.js', parent_id: parent, priority: 3 });
  const urgent = insertTask(db, { target_path: 'cli/b.js', priority: 1 });
  insertTask(db, { target_path: 'cli/c.js', assigned_agent_id: '@busy' });
  insertTask(db, { target_path: 'cli/d.js', status: 'in_progress' });
  const blankOwner = insertTask(db, { target_path: 'cli/e.js', assigned_agent_id: '' });
  assert.deepEqual(ids(selectDispatchTasks(db)), [urgent, blankOwner, child]);
  assert.deepEqual(ids(selectDispatchTasks(db, { parent })), [child]);
  assert.deepEqual(ids(selectDispatchTasks(db, { limit: 1 })), [urgent]);
  assert.deepEqual(ids(selectDispatchTasks(db, { status: 'in_progress' })).length, 1);
});

test('selectDispatchTasks: needs falls back to the rule tier, then standard; filters apply to the resolved tier', () => {
  assert.ok(DEEP_RULE, 'registry has at least one deep rule');
  const db = openDb();
  const own = insertTask(db, { target_path: 'cli/a.js', needs: 'light', rule_id: DEEP_RULE });
  const fromRule = insertTask(db, { target_path: 'cli/b.js', rule_id: `UNKNOWN_RULE_X, ${DEEP_RULE}` });
  const plain = insertTask(db, { target_path: 'apps/foo/c.js' });
  const tasks = selectDispatchTasks(db);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  assert.equal(byId.get(own).needs, 'light');
  assert.equal(byId.get(own).needsSource, 'task');
  assert.equal(byId.get(fromRule).needs, 'deep');
  assert.equal(byId.get(fromRule).needsSource, 'rule');
  assert.equal(byId.get(plain).needs, 'standard');
  assert.deepEqual(ids(selectDispatchTasks(db, { needs: 'deep' })), [fromRule]);
  assert.deepEqual(ids(selectDispatchTasks(db, { rule: DEEP_RULE })), [own, fromRule]);
  assert.deepEqual(ids(selectDispatchTasks(db, { repo: 'apps/foo/' })), [plain]);
  assert.deepEqual(ids(selectDispatchTasks(db, { repo: 'apps/fo' })), []);
});

test('selectDispatchTasks: tolerates a db without the needs column and a missing db', () => {
  const db = openDb();
  db.exec('ALTER TABLE agent_tasks DROP COLUMN needs;');
  const now = Date.now();
  db.prepare("INSERT INTO agent_tasks (title, target_path, created_at, updated_at) VALUES ('Old', 'cli/a.js', ?, ?)").run(now, now);
  const tasks = selectDispatchTasks(db);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].needs, 'standard');
  assert.deepEqual(selectDispatchTasks(null), []);
  assert.equal(resolveTaskNeeds({ needs: 'bogus', rule_id: '' }), 'standard');
});

test('routeModel: built-in defaults per tier; unknown tiers route as standard', () => {
  // light is sonnet/low since #2494; haiku is reserved for tasks that say they are mechanical (team-dispatch-v2.js).
  assert.deepEqual(routeModel('light'), { model: 'sonnet', effort: 'low' });
  assert.deepEqual(routeModel('standard'), { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(routeModel('deep'), { model: 'opus', effort: 'high' });
  assert.deepEqual(routeModel('huge', null), { ...DEFAULT_MODEL_ROUTING.standard });
});

test('routeModel: config override as a name, a list (#1962 shape) or { model, effort }', () => {
  const routing = {
    light: 'claude-haiku-x',
    standard: ['claude-sonnet-y', 'fallback'],
    deep: { model: 'claude-opus-z', effort: 'max' }
  };
  assert.deepEqual(routeModel('light', routing), { model: 'claude-haiku-x', effort: 'low' });
  assert.deepEqual(routeModel('standard', routing), { model: 'claude-sonnet-y', effort: 'medium' });
  assert.deepEqual(routeModel('deep', routing), { model: 'claude-opus-z', effort: 'max' });
  assert.deepEqual(routeModel('deep', { deep: { effort: 'turbo' } }), { model: 'opus', effort: 'high' });
});

test('loadModelRouting: reads .chemx/config.json modelRouting, null when absent or malformed', (t) => {
  const root = makeRoot(t);
  assert.equal(loadModelRouting(root), null);
  fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify({ modelRouting: { light: ['haiku-pin'] } }));
  assert.deepEqual(loadModelRouting(root), { light: ['haiku-pin'] });
  fs.writeFileSync(path.join(root, '.chemx', 'config.json'), '{ not json');
  assert.equal(loadModelRouting(root), null);
});

test('buildDispatchPlan: live foreign lease skips the task, own lease does not, config routing applies', (t) => {
  const root = makeRoot(t);
  fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify({ modelRouting: { standard: { model: 'sonnet-pinned', effort: 'high' } } }));
  const db = openDb(path.join(root, '.chemx', 'index.db'));
  t.after(() => db.close());
  const free = insertTask(db, { target_path: 'cli/free.js' });
  const locked = insertTask(db, { target_path: 'cli/locked.js' });
  const mine = insertTask(db, { target_path: 'cli/mine.js' });
  const expired = insertTask(db, { target_path: 'cli/expired.js' });
  const now = Date.now();
  const lease = db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose, pid) VALUES (?, ?, ?, ?, ?, 0)');
  lease.run('cli/locked.js', '@other', now, now + 60_000, '#99');
  lease.run('cli/mine.js', '@dispatcher', now, now + 60_000, '');
  lease.run('cli/expired.js', '@other', now - 120_000, now - 60_000, '');
  const plan = buildDispatchPlan(db, { root, agentId: '@dispatcher', parent: undefined, maxAgents: 4, maxTasksPerAgent: 1 });
  const dispatchedIds = plan.batches.flatMap((batch) => ids(batch.tasks));
  assert.deepEqual(dispatchedIds.sort(), [free, mine, expired].sort());
  assert.deepEqual(plan.skipped.map((entry) => [entry.id, entry.reason, entry.lease.lockedBy]), [[locked, 'locked', '@other']]);
  assert.equal(plan.routingSource, 'config');
  assert.ok(plan.batches.every((batch) => batch.model === 'sonnet-pinned' && batch.effort === 'high'));
  assert.deepEqual(plan.totals, { selected: 4, dispatched: 3, skipped: 1, agents: 3 });
  assert.equal(plan.batches[0].handle, '@dispatch-queue-1');
});

test('buildDispatchPlan: files come from target_path only unless useDescription opts in (#2429)', () => {
  const db = openDb();
  insertTask(db, { target_path: 'cli/a.js', description: 'touches cli/b.js too' });
  const plan = buildDispatchPlan(db, { root: '/nonexistent-root', routing: null, leaseCheck: () => null, isKnownFile: () => true });
  assert.deepEqual(plan.batches[0].files, ['cli/a.js']);
  const opted = buildDispatchPlan(db, { root: '/nonexistent-root', routing: null, leaseCheck: () => null, isKnownFile: () => true, useDescription: true });
  assert.deepEqual(opted.batches[0].files, ['cli/a.js', 'cli/b.js']);
});

test('selectDispatchTasks: explicit ids select open tasks whatever their assignee, never closed ones', () => {
  const db = openDb();
  const queued = insertTask(db, { target_path: 'cli/a.js' });
  const claimed = insertTask(db, { target_path: 'cli/b.js', status: 'in_progress', assigned_agent_id: '@peer' });
  const done = insertTask(db, { target_path: 'cli/c.js', status: 'done' });
  const rows = selectDispatchTasks(db, { ids: [queued, claimed, done] });
  assert.deepEqual(ids(rows), [queued, claimed]);
  assert.equal(rows[1].assigned_agent_id, '@peer');
});

test('buildDispatchPlan: routing override and injected lease check bypass config and disk', () => {
  const db = openDb();
  const parent = insertTask(db, { title: 'Group' });
  insertTask(db, { target_path: 'cli/a.js', needs: 'light', parent_id: parent });
  const plan = buildDispatchPlan(db, { root: '/nonexistent-root', routing: null, leaseCheck: () => null, parent });
  assert.equal(plan.routingSource, 'defaults');
  assert.deepEqual([plan.batches[0].model, plan.batches[0].effort], ['sonnet', 'low']);
  assert.equal(plan.batches[0].handle, `@dispatch-${parent}-1`);
  assert.deepEqual(plan.totals, { selected: 1, dispatched: 1, skipped: 0, agents: 1 });
});
