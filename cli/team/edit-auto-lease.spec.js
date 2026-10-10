/**
 * #4492: an identified agent that patches or writes a file nobody leases takes the lease first;
 * a file leased by someone else is still refused; anonymous callers take nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getFileLockStatus } from './team-db-locks.js';
import { takeLeaseWhenFree } from '../edit-locks.js';
import { handleChemxPatch } from '../mcp/tools-patch.js';

// Keep a shell-exported CHEMX_PROJECT_ROOT from redirecting the temp project's db.
const savedRoot = process.env.CHEMX_PROJECT_ROOT;
delete process.env.CHEMX_PROJECT_ROOT;
const restoreRoot = () => Object.assign(process.env, savedRoot === undefined ? {} : { CHEMX_PROJECT_ROOT: savedRoot });
test.after(restoreRoot);

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-auto-lease-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const patchArgs = { path: 'src/a.js', targetContent: '1', replacementContent: '2' };
const leaseOf = (db, root) => getFileLockStatus(db, 'src/a.js', { cwd: root }).lease;

test('an edit by @a on a free file leaves @a holding it, with the claimed task as purpose', (t) => {
  const { root, db } = makeProject(t);
  const now = Date.now();
  db.prepare("INSERT INTO agent_tasks (title, status, assigned_agent_id, created_at, updated_at) VALUES ('t', 'in_progress', '@a', ?, ?)").run(now, now);
  const id = db.prepare('SELECT id FROM agent_tasks').get().id;
  assert.equal(handleChemxPatch({ ...patchArgs, agentId: '@a' }, root).status, 'ok');
  const lease = leaseOf(db, root);
  assert.equal(lease.locked_by, '@a');
  assert.equal(lease.purpose, `#${id}`);
  assert.ok(lease.expires_at > Date.now());
  const feed = db.prepare("SELECT author_id FROM agent_feed WHERE event_type = 'lock_acquired'").all();
  assert.deepEqual(feed.map((row) => row.author_id), ['@a']);
});

test('an edit by @b after that is refused while @a holds the lease', (t) => {
  const { root, db } = makeProject(t);
  handleChemxPatch({ ...patchArgs, agentId: '@a' }, root);
  const second = { path: 'src/a.js', targetContent: '2', replacementContent: '3' };
  assert.throws(() => handleChemxPatch({ ...second, agentId: '@b' }, root), (err) => err.code === 'CHEMX_FILE_LOCKED');
  assert.equal(leaseOf(db, root).locked_by, '@a');
  assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf-8'), 'export const a = 2;\n');
});

test('anonymous callers take no lease', (t) => {
  const { root, db } = makeProject(t);
  const res = takeLeaseWhenFree(root, path.join(root, 'src/a.js'), undefined, {});
  assert.deepEqual(res, { taken: false, reason: 'anonymous' });
  assert.equal(leaseOf(db, root), null);
});

test('a lease already held by the editor is left as it is', (t) => {
  const { root, db } = makeProject(t);
  handleChemxPatch({ ...patchArgs, agentId: '@a' }, root);
  const res = takeLeaseWhenFree(root, path.join(root, 'src/a.js'), '@a', {});
  assert.equal(res.reason, 'already_leased');
  assert.equal(leaseOf(db, root).locked_by, '@a');
});
