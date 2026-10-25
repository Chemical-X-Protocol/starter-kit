import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { handleLockCommand } from './team-commands-lock.js';
import { requestFileLock } from './team-db-locks.js';

const setup = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lockpl-'));
  return { db, cwd };
};

const withFiles = (names) => {
  const { db, cwd } = setup();
  names.forEach((name) => fs.writeFileSync(path.join(cwd, name), ''));
  return { db, cwd };
};

const leased = (db) => db.prepare('SELECT file_path FROM file_leases ORDER BY file_path').all().map((row) => row.file_path);

test('lock acquire refuses a space-joined list that is not a path (#2559)', () => {
  const { db, cwd } = setup();
  const res = handleLockCommand(db, ['acquire', 'a.js b.js c.js'], { as: '@t' }, false, cwd);
  assert.equal(res.error, 'path_list');
});

test('lock acquire still allows an existing path with a space', () => {
  const { db, cwd } = setup();
  fs.writeFileSync(path.join(cwd, 'my file.js'), '');
  const res = handleLockCommand(db, ['acquire', 'my file.js'], { as: '@t' }, false, cwd);
  assert.notEqual(res.error, 'path_list');
});

test('lock acquire takes several paths as several arguments and leases each (#6747)', () => {
  const { db, cwd } = withFiles(['a.js', 'b.js', 'c.js']);
  const res = handleLockCommand(db, ['a.js', 'b.js', 'c.js'], { as: '@t' }, false, cwd);
  assert.deepEqual(leased(db), ['a.js', 'b.js', 'c.js']);
  assert.deepEqual(res.summary, { granted: 3, queued: 0, refused: 0 });
  assert.deepEqual(res.results.map((one) => one.file), ['a.js', 'b.js', 'c.js']);
  const explicit = handleLockCommand(db, ['acquire', 'a.js', 'b.js', 'a.js'], { as: '@t' }, false, cwd);
  assert.equal(explicit.results.length, 2, 'a repeated path is handled once');
});

test('a mixed call reports each path on its own: granted, queued behind the holder, refused', () => {
  const { db, cwd } = withFiles(['a.js', 'b.js']);
  requestFileLock(db, 'b.js', '@holder', { cwd });
  const res = handleLockCommand(db, ['a.js', 'b.js', 'nope.js'], { as: '@t' }, false, cwd);
  const [first, second, third] = res.results;
  assert.equal(first.granted, true);
  assert.equal(second.queued, true);
  assert.equal(second.currentHolder, '@holder');
  assert.equal(third.reason, 'path_not_found');
  assert.deepEqual(res.summary, { granted: 1, queued: 1, refused: 1 });
});

test('a joined argument inside a list is refused alone; the real paths are still leased', () => {
  const { db, cwd } = withFiles(['a.js', 'b.js']);
  const res = handleLockCommand(db, ['a.js', 'x.js y.js', 'b.js'], { as: '@t' }, false, cwd);
  assert.equal(res.results[1].error, 'path_list');
  assert.deepEqual(leased(db), ['a.js', 'b.js']);
});
