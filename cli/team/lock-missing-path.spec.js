/**
 * #4544: lock acquire from the CLI or MCP refuses a path that does not exist, instead of storing a
 * phantom lease; a doubled prefix gets a "did you mean" hint, and --new allows a file about to be created.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from './team-db-locks.js';

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'kit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'kit', 'lanes.json'), '{}\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const leaseCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM file_leases').get().n;

test('a doubled prefix is refused with a suggestion and stores no lease', (t) => {
  const { root, db } = makeProject(t);
  const res = requestFileLock(db, 'kit/lanes.json', '@spec', { cwd: path.join(root, 'kit'), requireExisting: true });
  assert.equal(res.granted, false);
  assert.equal(res.reason, 'path_not_found');
  assert.equal(res.suggestion, path.join('kit', 'lanes.json'));
  assert.match(res.message, /Did you mean kit\/lanes\.json\?/);
  assert.equal(leaseCount(db), 0);
});

test('an existing path is granted and allowNew-style callers may lease a file to be created', (t) => {
  const { root, db } = makeProject(t);
  assert.equal(requestFileLock(db, 'lanes.json', '@spec', { cwd: path.join(root, 'kit'), requireExisting: true }).granted, true);
  assert.equal(requestFileLock(db, 'kit/new.js', '@spec', { cwd: root, requireExisting: false }).granted, true);
  assert.equal(requestFileLock(db, 'kit/never.js', '@spec', { cwd: root, requireExisting: true }).reason, 'path_not_found');
});
