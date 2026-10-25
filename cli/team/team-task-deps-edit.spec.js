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

test('--deps, --add-dep and --rm-dep take their value as the next word as well as after an equals sign (#6746)', (t) => {
  const { root, db, ids: [a, b, c] } = makeBoard(t);
  update(root, [c, '--deps', a]);
  assert.deepEqual(getTask(db, c).dependencies, [a]);
  update(root, [c, '--add-dep', b]);
  assert.deepEqual(getTask(db, c).dependencies, [a, b]);
  update(root, [c, '--rm-dep', a]);
  assert.deepEqual(getTask(db, c).dependencies, [b]);
  update(root, [c, '--deps', '']);
  assert.deepEqual(getTask(db, c).dependencies, []);
  update(root, [c, '--add-dep', `${a},${b}`]);
  assert.deepEqual(getTask(db, c).dependencies, [a, b]);
});

test('update with only --add-dep <ids> leaves the status alone and writes no status', (t) => {
  const { root, db, ids: [a, b, c] } = makeBoard(t);
  const before = getTask(db, c).status;
  const res = update(root, [c, '--add-dep', `${a},${b}`]);
  assert.equal(getTask(db, c).status, before);
  assert.deepEqual(getTask(db, c).dependencies, [a, b]);
  assert.equal(res.status, before);
});

test('update refuses a status it does not know and writes nothing (#6746)', (t) => {
  const { root, db, ids: [a, b] } = makeBoard(t);
  const before = getTask(db, b);
  for (const bogus of ['1555,1556', 'finished', 'completed', 'duplicate', 'In_Progress']) {
    const res = update(root, [b, bogus]);
    assert.equal(res.refused, true, `${bogus} is refused`);
    assert.match(res.error, /queued, in_progress, review, blocked, done, cancelled/);
  }
  const after = getTask(db, b);
  assert.equal(after.status, before.status);
  assert.equal(after.updated_at, before.updated_at);
  const viaFlag = update(root, [b, '--status', 'nope']);
  assert.equal(viaFlag.refused, true);
  assert.equal(getTask(db, b).status, before.status);
  const withDeps = update(root, [b, 'nope', `--deps=${a}`]);
  assert.equal(withDeps.refused, true);
  assert.deepEqual(getTask(db, b).dependencies, [], 'a refused status also leaves the dependencies unedited');
});

test('update accepts every status in the list, as a word and as --status', (t) => {
  const { root, db, ids: [a] } = makeBoard(t);
  for (const status of ['in_progress', 'review', 'blocked', 'queued']) {
    update(root, [a, status]);
    assert.equal(getTask(db, a).status, status);
  }
  update(root, [a, '--status', 'review']);
  assert.equal(getTask(db, a).status, 'review');
  update(root, [a, '--status=cancelled']);
  assert.equal(getTask(db, a).status, 'cancelled');
});

test('update names a value flag that has no value and writes nothing (#6746)', (t) => {
  const { root, db, ids: [a, b] } = makeBoard(t);
  const lastWord = runTeamCli(['task', 'update', String(b), '--add-dep'], false, root);
  assert.equal(lastWord.refused, true);
  assert.match(lastWord.error, /--add-dep/);
  const beforeFlag = runTeamCli(['task', 'update', String(b), `--rm-dep`, '--as=@orch'], false, root);
  assert.match(beforeFlag.error, /--rm-dep/);
  assert.deepEqual(getTask(db, b).dependencies, []);
  assert.equal(getTask(db, a).status, 'queued');
});

test('on the CLI a refused status and a missing value print the reason and exit 1', (t) => {
  const { root, ids: [a] } = makeBoard(t);
  const savedExitCode = process.exitCode;
  const originalWrite = process.stderr.write;
  const errors = [];
  const exitCodes = [];
  process.stderr.write = (chunk) => {
    errors.push(String(chunk));
    return true;
  };
  try {
    for (const args of [[String(a), 'bogus'], [String(a), '--add-dep']]) {
      process.exitCode = undefined;
      runTeamCli(['task', 'update', ...args], true, root);
      exitCodes.push(process.exitCode);
    }
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = savedExitCode;
  }
  assert.deepEqual(exitCodes, [1, 1]);
  assert.match(errors[0], /Unknown status "bogus"/);
  assert.match(errors[1], /--add-dep needs a value/);
});
