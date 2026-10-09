/**
 * Lease keys are project-root relative (review follow-up on #1481): a lock taken
 * from a subdirectory and the same file locked from the root share one lease, so
 * two agents can never both hold it and the write guard sees it from anywhere.
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
import { findBlockingLease } from './write-lock-guard.js';

const CLI_PATH = fileURLToPath(new URL('../index.js', import.meta.url));

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-key-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"lease-key-fixture"}\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const runCli = (cwd, args) => {
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.CHEMX_AGENT_ID;
  delete env.CHEMX_PROJECT_ROOT;
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd, env, encoding: 'utf-8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
};

const leaseRows = (root) => {
  const db = openIndexDb(root);
  return db.prepare('SELECT file_path, locked_by FROM file_leases ORDER BY file_path').all().map((r) => ({ ...r }));
};

test('cli: a lock taken from a subdirectory is keyed from the project root', (t) => {
  const { root } = makeProject(t);
  const res = JSON.parse(runCli(path.join(root, 'src'), ['team', 'lock', 'a.js', '--as=@dave', '--json']).stdout);
  assert.equal(res.granted, true);
  assert.deepEqual(leaseRows(root), [{ file_path: 'src/a.js', locked_by: '@dave' }]);
});

test('cli: the same file locked from the root and from a subdirectory excludes', (t) => {
  const { root } = makeProject(t);
  runCli(path.join(root, 'src'), ['team', 'lock', 'a.js', '--as=@dave', '--json']);
  const second = JSON.parse(runCli(root, ['team', 'lock', 'src/a.js', '--as=@alice', '--json']).stdout);
  assert.equal(second.granted, false, 'alice must queue behind dave');
  assert.equal(second.currentHolder, '@dave');
});

test('cli: write from the root refuses a file leased from a subdirectory', (t) => {
  const { root } = makeProject(t);
  runCli(path.join(root, 'src'), ['team', 'lock', 'a.js', '--as=@dave', '--json']);
  const write = runCli(root, ['write', 'src/a.js', '--content=export const a = 2;', '--as=@bob', '--json']);
  assert.notEqual(write.code, 0);
  assert.match(write.stderr + write.stdout, /locked by @dave/);
  assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf-8'), 'export const a = 1;\n');
});

test('api: acquire, status and release agree on one key whatever the cwd', (t) => {
  const { root, db } = makeProject(t);
  const sub = path.join(root, 'src');
  assert.equal(requestFileLock(db, 'a.js', '@dave', { cwd: sub }).lease.file_path, 'src/a.js');
  assert.equal(requestFileLock(db, 'src/a.js', '@alice', { cwd: root }).granted, false);
  assert.equal(getFileLockStatus(db, 'a.js', { cwd: sub }).lease.locked_by, '@dave');
  assert.equal(findBlockingLease(path.join(root, 'src/a.js'), sub, '@bob').locked_by, '@dave');
  assert.equal(releaseFileLock(db, 'src/a.js', '@dave', { cwd: root }).success, true);
});
