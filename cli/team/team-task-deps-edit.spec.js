/**
 * Tasks: `task update --deps / --add-dep / --rm-dep` edit hard prerequisites (#2524).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getTask } from './team-db-tasks.js';
import { runTeamCli } from './team-commands.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openIndexDb(root, { fresh: true });
  const ids = [1, 2, 3].map((n) => runTeamCli(['task', 'add', `dep subject ${n}`, '--as=@orch'], false, root).id);
  return { root, db, ids };
};

const update = (root, args) => runTeamCli(['task', 'update', ...args.map(String), '--as=@orch'], false, root);

test('--deps replaces, --add-dep and --rm-dep edit the list', (t) => {
  const { root, db, ids: [a, b, c] } = makeBoard(t);
  update(root, [c, `--deps=${a}`]);
  assert.deepEqual(getTask(db, c).dependencies, [a]);
  update(root, [c, `--add-dep=${b}`]);
  assert.deepEqual(getTask(db, c).dependencies, [a, b]);
  update(root, [c, `--rm-dep=${a}`]);
  assert.deepEqual(getTask(db, c).dependencies, [b]);
  update(root, [c, '--deps=']);
  assert.deepEqual(getTask(db, c).dependencies, []);
});

test('a cycle is refused and nothing is written', (t) => {
  const { root, db, ids: [a, b] } = makeBoard(t);
  update(root, [a, `--deps=${b}`]);
  const res = update(root, [b, `--deps=${a}`]);
  assert.equal(res.refused, true);
  assert.deepEqual(getTask(db, b).dependencies, []);
});

test('a non-numeric id is reported by its raw token and does not clear deps', (t) => {
  const { root, db, ids: [a, b] } = makeBoard(t);
  update(root, [b, `--deps=${a}`]);
  const res = update(root, [b, '--deps=abc']);
  assert.equal(res.refused, true);
  assert.match(res.error, /invalid dependencies/);
  assert.deepEqual(getTask(db, b).dependencies, [a]);
});

test('a dependency edit combined with a status applies both, and a refusal applies neither', (t) => {
  const { root, db, ids: [a, b] } = makeBoard(t);
  update(root, [b, 'blocked', `--deps=${a}`, '--reason=waiting']);
  assert.deepEqual(getTask(db, b).dependencies, [a]);
  assert.equal(getTask(db, b).status, 'blocked');
  update(root, [a, 'blocked', `--deps=${b}`]);
  assert.notEqual(getTask(db, a).status, 'blocked');
});
