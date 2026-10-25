/**
 * The boards a handle keeps leases on while its commands run from somewhere else (#6758): a builder in
 * a git worktree outside the board root. Boards are temp dirs with their own team db; the claim
 * pointers live in a temp directory (CHEMX_BOARD_CLAIMS_DIR). Nothing real is read or written.
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
import { claimedBoardRoots } from './lease-claim-roots.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeEnv = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-claim-roots-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ...process.env, CHEMX_BOARD_CLAIMS_DIR: dir };
};

const makeBoard = (t, taskCount = 2) => {
  const fixture = buildStandalone('chemx-claim-board-');
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

test('the board of a handle\'s in_progress claim is listed', (t) => {
  const env = makeEnv(t);
  const board = makeBoard(t);
  claim(board, 1, '@h', env);

  assert.deepEqual(claimedBoardRoots('@h', { env }), [board.root]);
});

test('a claim whose task is done, or that another handle now holds, is not listed', (t) => {
  const env = makeEnv(t);
  const finished = makeBoard(t);
  const reassigned = makeBoard(t);
  claim(finished, 1, '@h', env);
  claim(reassigned, 1, '@h', env);
  updateTaskStatus(finished.db, 1, 'done');
  reassigned.db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@other' WHERE id = 1").run();

  assert.deepEqual(claimedBoardRoots('@h', { env }), []);
});

test('only the handle\'s own pointer counts, and a board listed twice is listed once', (t) => {
  const env = makeEnv(t);
  const board = makeBoard(t, 3);
  claim(board, 1, '@h', env);
  claim(board, 2, '@h', env);
  claim(board, 3, '@someone-else', env);

  assert.deepEqual(claimedBoardRoots('@h', { env }), [board.root]);
  assert.deepEqual(claimedBoardRoots('@nobody', { env }), []);
});

test('a board whose db is gone is skipped, and no pointer directory means no roots', (t) => {
  const env = makeEnv(t);
  const board = makeBoard(t);
  claim(board, 1, '@h', env);
  board.db.close();
  fs.rmSync(path.join(board.root, '.chemx'), { recursive: true, force: true });

  assert.deepEqual(claimedBoardRoots('@h', { env }), []);
  assert.deepEqual(claimedBoardRoots('@h', { env: { ...process.env, CHEMX_BOARD_CLAIMS_DIR: '' } }), [], 'a spec process with no pointer directory');
});
