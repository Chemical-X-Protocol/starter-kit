import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask } from './team-db.js';
import { setPoints } from './team-points.js';
import { validatePlan, planTask } from './team-plan.js';
import { runTaskCommand } from './team-commands-task.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };

const child = (overrides = {}) => ({ title: 'a child', points: 3, needs: 'standard', files: ['cli/a.js'], acceptance: 'cli/a.spec.js', ...overrides });

const cleanChildren = () => [child(), child({ title: 'b child', points: 5, files: ['cli/b.js'], acceptance: 'cli/b.spec.js' })];

const writePlanFile = (t, children) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(children));
  return { dir, file };
};

const childCount = (db, parentId) => db.prepare('SELECT COUNT(*) AS n FROM agent_tasks WHERE parent_id = ?').get(parentId).n;

const assertRefused = (plan, fragment) => {
  const { errors } = validatePlan(plan);
  assert.ok(errors.some((error) => error.includes(fragment)), `expected an error containing "${fragment}", got ${JSON.stringify(errors)}`);
};

test('team plan: a plan with no children is refused', () => {
  assertRefused({ parentPoints: 8, children: [] }, 'no children');
  assertRefused({ parentPoints: 8 }, 'no children');
});

test('team plan: a child whose points are off the Fibonacci set is refused', () => {
  assertRefused({ parentPoints: null, children: [child({ points: 4 })] }, 'points must be one of');
});

test('team plan: a child above 5 points is refused even on the Fibonacci set', () => {
  assertRefused({ parentPoints: null, children: [child({ points: 8 })] }, 'points must be one of 1, 2, 3, 5');
});

test('team plan: child points summing to more than twice the parent are refused', () => {
  assertRefused({ parentPoints: 3, children: cleanChildren() }, 'sum to 8');
});

test('team plan: child points summing to less than half the parent are refused', () => {
  assertRefused({ parentPoints: 21, children: cleanChildren() }, 'sum to 8');
});

test('team plan: a null parent points value skips the sum check', () => {
  assert.deepEqual(validatePlan({ parentPoints: null, children: cleanChildren() }), { errors: [] });
});

test('team plan: a child with no acceptance spec path is refused', () => {
  assertRefused({ parentPoints: null, children: [child({ acceptance: '' })] }, 'no acceptance spec path');
  assertRefused({ parentPoints: null, children: [child({ acceptance: undefined })] }, 'no acceptance spec path');
});

test('team plan: a child with no files is refused', () => {
  assertRefused({ parentPoints: null, children: [child({ files: [] })] }, 'has no files');
  assertRefused({ parentPoints: null, children: [child({ files: undefined })] }, 'has no files');
});

test('team plan: two children sharing a file are refused', () => {
  const children = [child(), child({ title: 'b child', files: ['cli/b.js', 'cli/a.js'] })];
  assertRefused({ parentPoints: null, children }, 'File cli/a.js is shared by children 1 and 2');
});

test('team plan: a clean plan passes with no errors', () => {
  assert.deepEqual(validatePlan({ parentPoints: 8, children: cleanChildren() }), { errors: [] });
});

test('team plan: the command dry-runs by default and creates nothing', (t) => {
  const db = freshDb();
  const parent = createTask(db, { title: 'deep parent', needs: 'deep' });
  setPoints(db, parent.id, 8);
  const { dir, file } = writePlanFile(t, cleanChildren());
  const result = runTaskCommand({ db, root: dir, repo: '.' }, ['plan', String(parent.id)], { file }, [], false, dir);
  assert.equal(result.applied, false);
  assert.equal(result.children.length, 2);
  assert.deepEqual(result.created, []);
  assert.equal(childCount(db, parent.id), 0);
});

test('team plan: --apply creates each child under the parent with its needs, points, files and acceptance', (t) => {
  const db = freshDb();
  const parent = createTask(db, { title: 'deep parent', needs: 'deep' });
  setPoints(db, parent.id, 8);
  const { file } = writePlanFile(t, cleanChildren());
  const result = planTask(db, parent.id, { file, apply: true });
  assert.equal(result.created.length, 2);
  const rows = db.prepare('SELECT title, needs, points, description FROM agent_tasks WHERE parent_id = ? ORDER BY id').all(parent.id);
  assert.deepEqual(rows.map((row) => [row.title, row.needs, row.points]), [['a child', 'standard', 3], ['b child', 'standard', 5]]);
  assert.ok(rows[0].description.includes('cli/a.js') && rows[0].description.includes('cli/a.spec.js'));
});

test('team plan: an invalid plan file is refused through the command and creates nothing', (t) => {
  const db = freshDb();
  const parent = createTask(db, { title: 'deep parent' });
  const { dir, file } = writePlanFile(t, [child({ points: 13 })]);
  const result = runTaskCommand({ db, root: dir, repo: '.' }, ['plan', String(parent.id)], { file, apply: true }, [], false, dir);
  assert.equal(result.refused, true);
  assert.equal(result.errors.length, 1);
  assert.equal(childCount(db, parent.id), 0);
});
