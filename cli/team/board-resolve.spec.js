/**
 * Which board a handle's work belongs to (#6750). Boards are temp dirs with their own team db; the
 * claim pointers live in a temp directory (CHEMX_BOARD_CLAIMS_DIR). Nothing real is read or written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, updateTaskStatus } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { claimWithIgnoreDeps } from './claim-ignore-deps.js';
import { buildStandalone } from './coordination-fixture.js';
import { resolveHandleBoard } from './board-resolve.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeEnv = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-resolve-claims-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ...process.env, CHEMX_BOARD_CLAIMS_DIR: dir };
};

const makeBoard = (t, taskCount) => {
  const fixture = buildStandalone('chemx-board-');
  t.after(() => fixture.cleanup());
  const db = openIndexDb(fixture.root);
  for (let n = 0; n < taskCount; n += 1) createTask(db, { title: `task ${n + 1}` });
  return { root: fixture.root, db };
};

const claim = (board, id, handle, env) => {
  registerAgent(board.db, { id: handle, role: 'executor' });
  const res = claimWithIgnoreDeps(board.db, id, handle, undefined, { root: board.root, env });
  assert.equal(res.success, true);
};

const pick = (resolved) => [resolved.source, resolved.root, resolved.taskId, resolved.found];

test('with no claim the directory\'s own board answers, as before', (t) => {
  const env = makeEnv(t);
  const here = makeBoard(t, 3);
  const resolved = resolveHandleBoard(here.root, { handle: '@h', taskRef: 2, env });
  assert.deepEqual(pick(resolved), ['cwd', here.root, 2, true]);
  assert.deepEqual(resolved.looked, [{ root: here.root, source: 'cwd' }]);
});

test('the board of the handle\'s in_progress task wins over a directory board that has a different task with that number', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const plugin = makeBoard(t, 10);
  claim(app, 10, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: '#10', env });
  assert.deepEqual(pick(resolved), ['claim', app.root, 10, true]);
  assert.deepEqual(resolved.looked.map((board) => board.root), [app.root, plugin.root]);
});

test('a number the directory board lacks is accepted when the handle\'s board has it', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const plugin = makeBoard(t, 3);
  claim(app, 9, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: 10, env });
  assert.deepEqual(pick(resolved), ['claim', app.root, 10, true]);
});

test('a number both boards have, that is not the handle\'s claim, stays on the directory board', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const plugin = makeBoard(t, 10);
  claim(app, 9, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: 4, env });
  assert.deepEqual(pick(resolved), ['cwd', plugin.root, 4, true]);
});

test('a number no board has is not found, and every board looked in is listed in order', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 5);
  const plugin = makeBoard(t, 3);
  claim(app, 5, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: 99, env });
  assert.equal(resolved.found, false);
  assert.equal(resolved.taskId, null);
  assert.deepEqual(resolved.looked, [{ root: app.root, source: 'claim' }, { root: plugin.root, source: 'cwd' }]);
});

test('a claim that is no longer in_progress, or whose board is gone, is ignored', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const gone = makeBoard(t, 10);
  const plugin = makeBoard(t, 3);
  claim(app, 10, '@h', env);
  claim(gone, 10, '@h', env);
  updateTaskStatus(app.db, 10, 'done');
  fs.rmSync(path.join(gone.root, '.chemx'), { recursive: true, force: true });
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: 10, env });
  assert.equal(resolved.found, false);
  assert.deepEqual(resolved.looked, [{ root: plugin.root, source: 'cwd' }]);
});

test('another handle\'s claim is not this handle\'s board', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const plugin = makeBoard(t, 3);
  claim(app, 10, '@someone-else', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', taskRef: 10, env });
  assert.equal(resolved.found, false);
});

test('--board is exclusive: the named board answers even when the handle claimed elsewhere', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 10);
  const other = makeBoard(t, 10);
  const plugin = makeBoard(t, 10);
  claim(app, 10, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', board: other.root, taskRef: 10, env });
  assert.deepEqual(pick(resolved), ['flag', other.root, 10, true]);
  assert.deepEqual(resolved.looked, [{ root: other.root, source: 'flag' }]);
});

test('--board accepts a directory inside the board and a path relative to the start directory', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 4);
  const plugin = makeBoard(t, 4);
  const inner = resolveHandleBoard(plugin.root, { handle: '@h', board: path.join(app.root, 'src'), taskRef: 1, env });
  const relative = resolveHandleBoard(plugin.root, { handle: '@h', board: path.relative(plugin.root, app.root), taskRef: 1, env });
  assert.equal(inner.root, app.root);
  assert.equal(relative.root, app.root);
});

test('--board naming a missing path or a directory with no team db reports an error and picks nothing', (t) => {
  const env = makeEnv(t);
  const plugin = makeBoard(t, 4);
  const bare = buildStandalone('chemx-bare-');
  t.after(() => bare.cleanup());
  const missing = resolveHandleBoard(plugin.root, { handle: '@h', board: path.join(plugin.root, 'nope'), taskRef: 1, env });
  const noDb = resolveHandleBoard(plugin.root, { handle: '@h', board: bare.root, taskRef: 1, env });
  assert.match(missing.error, /does not exist/);
  assert.match(noDb.error, /has no team db/);
  assert.equal(missing.root, null);
  assert.equal(noDb.root, null);
});

test('without a task number the directory\'s own board answers, claim or not (#6766)', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 3);
  const plugin = makeBoard(t, 3);
  const before = resolveHandleBoard(plugin.root, { handle: '@h', env });
  claim(app, 1, '@h', env);
  const after = resolveHandleBoard(plugin.root, { handle: '@h', env });
  assert.deepEqual([before.source, before.root, before.found], ['cwd', plugin.root, false]);
  assert.deepEqual([after.source, after.root, after.found], ['cwd', plugin.root, false]);
  assert.deepEqual(after.looked, [{ root: plugin.root, source: 'cwd' }]);
});

test('without a task number and a directory with no team db, the handle\'s claim board answers (#6766)', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 3);
  const bare = buildStandalone('chemx-bare-');
  t.after(() => bare.cleanup());
  claim(app, 1, '@h', env);
  const resolved = resolveHandleBoard(bare.root, { handle: '@h', env });
  assert.deepEqual([resolved.source, resolved.root, resolved.found], ['claim', app.root, false]);
});

test('without a task number --board is still the override (#6766)', (t) => {
  const env = makeEnv(t);
  const app = makeBoard(t, 3);
  const other = makeBoard(t, 3);
  const plugin = makeBoard(t, 3);
  claim(app, 1, '@h', env);
  const resolved = resolveHandleBoard(plugin.root, { handle: '@h', board: other.root, env });
  assert.deepEqual([resolved.source, resolved.root], ['flag', other.root]);
});

test('a directory with no team db and no claim has no board', (t) => {
  const env = makeEnv(t);
  const bare = buildStandalone('chemx-bare-');
  t.after(() => bare.cleanup());
  const resolved = resolveHandleBoard(bare.root, { handle: '@h', taskRef: 1, env });
  assert.equal(resolved.root, null);
  assert.deepEqual(resolved.looked, []);
});
