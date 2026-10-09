/**
 * Locks exclude for real (finding locks-no-real-exclusion, lock-queue-duplicates):
 * unique identity per process, write/patch honor leases, dead holders and stale
 * waiters are cleaned up, and re-polling never duplicates a queue entry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, releaseFileLock, getFileLockStatus } from './team-db-locks.js';
import { WAITER_TTL_MS } from './team-db-lock-promotion.js';
import { resolveAgentId, getProcessAgentId } from './agent-identity.js';
import { handleChemxTeamLock } from '../mcp/tools-team-locks.js';
import { handleChemxPatch } from '../mcp/tools-patch.js';

const CLI_PATH = fileURLToPath(new URL('../index.js', import.meta.url));

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-exclusion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const runCli = (root, args) => {
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.CHEMX_AGENT_ID;
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: root, env, encoding: 'utf-8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
};

test('identity: an anonymous caller gets a handle unique to its process, env and explicit ids win', () => {
  assert.match(getProcessAgentId(), new RegExp(`^@agent-${process.pid}-[0-9a-f]{6}$`));
  assert.equal(resolveAgentId(undefined, {}), getProcessAgentId(), 'stable within a process');
  assert.equal(resolveAgentId(undefined, { CHEMX_AGENT_ID: 'ci-bot' }), '@ci-bot');
  assert.equal(resolveAgentId('alice', { CHEMX_AGENT_ID: 'ci-bot' }), '@alice');
});

test('identity: two anonymous CLI processes do not share a lock', (t) => {
  const { root } = makeProject(t);
  const first = JSON.parse(runCli(root, ['team', 'lock', 'acquire', 'src/a.js', '--json']).stdout);
  const second = JSON.parse(runCli(root, ['team', 'lock', 'acquire', 'src/a.js', '--json']).stdout);
  assert.equal(first.granted, true);
  assert.equal(second.granted, false, 'a second anonymous agent must queue, not share the lease');
  assert.notEqual(second.currentHolder, '@agent');
});

test('write/patch: chemx refuses to modify a file another agent holds, and allows the holder', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@alice', { cwd: root, purpose: 'refactor' });

  const cliWrite = runCli(root, ['write', 'src/a.js', '--content=export const a = 2;', '--as=@mallory', '--json']);
  assert.notEqual(cliWrite.code, 0);
  assert.match(cliWrite.stderr + cliWrite.stdout, /locked by @alice/);
  assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf-8'), 'export const a = 1;\n', 'content untouched');

  const patchArgs = { path: 'src/a.js', targetContent: '1', replacementContent: '3' };
  assert.throws(() => handleChemxPatch({ ...patchArgs, agentId: '@mallory' }, root), (err) => err.code === 'CHEMX_FILE_LOCKED');
  const allowed = handleChemxPatch({ ...patchArgs, agentId: '@alice' }, root);
  assert.equal(allowed.status, 'ok');
  assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf-8'), 'export const a = 3;\n');
});

test('queue: re-polling a held lock keeps one entry and the same position', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@alice', { cwd: root });
  const polls = [1, 2, 3].map(() => requestFileLock(db, 'src/a.js', '@bob', { cwd: root }));
  const waiters = getFileLockStatus(db, 'src/a.js', { cwd: root }).waiters;
  assert.equal(waiters.length, 1);
  assert.deepEqual(polls.map((p) => p.position), [1, 1, 1]);
  assert.deepEqual(polls.map((p) => p.requeued), [false, true, true]);
});

test('queue: a waiter that stopped polling, or whose process died, is skipped on promotion', (t) => {
  const { root, db } = makeProject(t);
  const deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
  requestFileLock(db, 'src/a.js', '@alice', { cwd: root });
  requestFileLock(db, 'src/a.js', '@gone', { cwd: root });
  requestFileLock(db, 'src/a.js', '@crashed', { cwd: root, pid: deadPid });
  requestFileLock(db, 'src/a.js', '@carol', { cwd: root, pid: process.pid });
  db.prepare("UPDATE file_lock_queue SET last_seen_at = ? WHERE agent_id = '@gone'").run(Date.now() - WAITER_TTL_MS - 1);

  const release = releaseFileLock(db, 'src/a.js', '@alice', { cwd: root });
  assert.equal(release.promotedWaiter, '@carol');
  const lease = getFileLockStatus(db, 'src/a.js', { cwd: root }).lease;
  assert.equal(lease.pid, process.pid, 'the promoted lease carries the waiter pid so dead-holder cleanup can run');
  const expired = db.prepare("SELECT agent_id FROM file_lock_queue WHERE status = 'expired' ORDER BY id").all().map((r) => r.agent_id);
  assert.deepEqual(expired, ['@gone', '@crashed']);
});

test('mcp: lock acquire resolves an identity and records the long-lived server pid', async (t) => {
  const { root } = makeProject(t);
  const res = await handleChemxTeamLock({ action: 'acquire', filePath: 'src/a.js' }, root);
  assert.equal(res.granted, true);
  assert.equal(res.lease.locked_by, resolveAgentId());
  assert.equal(res.lease.pid, process.pid);
});
