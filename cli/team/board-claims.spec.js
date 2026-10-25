/**
 * Board claims (#6750): a claim leaves a pointer from the handle to the board that holds the task,
 * so a commit made in a directory that resolves to another board still finds it. Temp dirs only:
 * the pointer directory is always the spec's own (CHEMX_BOARD_CLAIMS_DIR), never the real home.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, getTask } from './team-db-tasks.js';
import { getAgent, registerAgent } from './team-db-agents.js';
import { claimWithIgnoreDeps } from './claim-ignore-deps.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { boardClaimsDir, recordBoardClaim, readBoardClaims, MAX_CLAIMS_PER_HANDLE } from './board-claims.js';

delete process.env.CHEMX_PROJECT_ROOT;

const tempDir = (t, prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const envFor = (dir) => ({ ...process.env, CHEMX_BOARD_CLAIMS_DIR: dir });

test('without CHEMX_BOARD_CLAIMS_DIR a spec process has no pointer directory, so it never writes the real home', () => {
  const env = { ...process.env };
  delete env.CHEMX_BOARD_CLAIMS_DIR;
  assert.equal(boardClaimsDir(env), null);
  assert.equal(recordBoardClaim({ handle: '@h', taskId: 1, root: '/x' }, { env }), false);
  assert.deepEqual(readBoardClaims('@h', { env }), []);
});

test('the pointer directory comes from CHEMX_BOARD_CLAIMS_DIR, and a relative value is refused', (t) => {
  const dir = tempDir(t, 'chemx-claims-dir-');
  assert.equal(boardClaimsDir(envFor(dir)), dir);
  assert.equal(boardClaimsDir({ ...process.env, CHEMX_BOARD_CLAIMS_DIR: 'relative/dir' }), null);
});

test('a recorded claim reads back newest first, one entry per board and task', (t) => {
  const env = envFor(tempDir(t, 'chemx-claims-'));
  assert.equal(recordBoardClaim({ handle: '@h', taskId: 1, root: '/board/a' }, { env, now: 100 }), true);
  recordBoardClaim({ handle: '@h', taskId: 2, root: '/board/b' }, { env, now: 200 });
  recordBoardClaim({ handle: '@h', taskId: 1, root: '/board/a' }, { env, now: 300 });
  assert.deepEqual(readBoardClaims('@h', { env }), [
    { root: '/board/a', taskId: 1, at: 300 },
    { root: '/board/b', taskId: 2, at: 200 }
  ]);
});

test('handles never see each other\'s claims, and an odd handle cannot leave the directory', (t) => {
  const dir = tempDir(t, 'chemx-claims-');
  const env = envFor(dir);
  recordBoardClaim({ handle: '@h', taskId: 1, root: '/board/a' }, { env });
  recordBoardClaim({ handle: '@../../evil', taskId: 9, root: '/board/z' }, { env });
  assert.deepEqual(readBoardClaims('@other', { env }), []);
  assert.equal(readBoardClaims('@../../evil', { env }).length, 1);
  assert.ok(fs.readdirSync(dir).every((name) => !name.includes('/')));
  assert.equal(fs.readdirSync(dir).length, 2);
});

test('only the newest claims of a handle are kept', (t) => {
  const env = envFor(tempDir(t, 'chemx-claims-'));
  for (let n = 1; n <= MAX_CLAIMS_PER_HANDLE + 3; n += 1) recordBoardClaim({ handle: '@h', taskId: n, root: `/board/${n}` }, { env, now: n });
  const claims = readBoardClaims('@h', { env });
  assert.equal(claims.length, MAX_CLAIMS_PER_HANDLE);
  assert.equal(claims[0].taskId, MAX_CLAIMS_PER_HANDLE + 3);
});

test('a damaged pointer file reads as no claims and the next claim replaces it', (t) => {
  const dir = tempDir(t, 'chemx-claims-');
  const env = envFor(dir);
  recordBoardClaim({ handle: '@h', taskId: 1, root: '/board/a' }, { env });
  const [file] = fs.readdirSync(dir);
  fs.writeFileSync(path.join(dir, file), '{not json');
  assert.deepEqual(readBoardClaims('@h', { env }), []);
  assert.equal(recordBoardClaim({ handle: '@h', taskId: 2, root: '/board/b' }, { env }), true);
  assert.equal(readBoardClaims('@h', { env }).length, 1);
});

test('claiming records the board root on the agent row, on the task and in the pointer file', (t) => {
  const dir = tempDir(t, 'chemx-claims-');
  const env = envFor(dir);
  const root = tempDir(t, 'chemx-claims-board-');
  const db = openIndexDb(root);
  const task = createTask(db, { title: 'claim me' });
  registerAgent(db, { id: '@h', role: 'executor' });
  const res = claimWithIgnoreDeps(db, task.id, '@h', undefined, { root, env });
  assert.equal(res.success, true);
  assert.equal(getAgent(db, '@h').metadata.boardRoot, root);
  assert.equal(getTask(db, task.id).result_payload.board_root, root);
  assert.equal(res.task.result_payload.board_root, root);
  assert.deepEqual(readBoardClaims('@h', { env }).map((claim) => [claim.root, claim.taskId]), [[root, task.id]]);
});

test('a refused claim leaves no pointer', (t) => {
  const env = envFor(tempDir(t, 'chemx-claims-'));
  const root = tempDir(t, 'chemx-claims-board-');
  const db = openIndexDb(root);
  const task = createTask(db, { title: 'taken' });
  claimWithIgnoreDeps(db, task.id, '@first', undefined, { root, env });
  const refused = claimWithIgnoreDeps(db, task.id, '@second', undefined, { root, env });
  assert.equal(refused.success, false);
  assert.deepEqual(readBoardClaims('@second', { env }), []);
});

const useClaimsDir = (t) => {
  const dir = tempDir(t, 'chemx-claims-env-');
  process.env.CHEMX_BOARD_CLAIMS_DIR = dir;
  t.after(() => { delete process.env.CHEMX_BOARD_CLAIMS_DIR; });
  return envFor(dir);
};

test('chemx team task claim (CLI) leaves the pointer and the board root on the task', (t) => {
  const env = useClaimsDir(t);
  const root = tempDir(t, 'chemx-claims-cli-');
  const added = runTeamCli(['task', 'add', 'cli claim', '--as=@orch'], false, root);
  const res = runTeamCli(['task', 'claim', String(added.id), '--as=@cli-h'], false, root);
  assert.equal(res.success, true);
  assert.deepEqual(readBoardClaims('@cli-h', { env }).map((claim) => [claim.root, claim.taskId]), [[root, added.id]]);
  assert.equal(getTask(openIndexDb(root), added.id).result_payload.board_root, root);
});

test('the MCP team task claim leaves the pointer too', async (t) => {
  const env = useClaimsDir(t);
  const root = tempDir(t, 'chemx-claims-mcp-');
  const added = runTeamCli(['task', 'add', 'mcp claim', '--as=@orch'], false, root);
  const res = await handleChemxTeamTask({ action: 'claim', taskId: added.id, agentId: '@mcp-h' }, root);
  assert.equal(res.success, true);
  assert.deepEqual(readBoardClaims('@mcp-h', { env }).map((claim) => [claim.root, claim.taskId]), [[root, added.id]]);
});
