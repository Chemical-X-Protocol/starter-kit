/**
 * #4479: a queued waiter leaves the FIFO queue with lock release; a stranger still gets not_holder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, releaseFileLock } from './team-db-locks.js';

const makeDb = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dequeue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return openIndexDb(root, { fresh: true });
};

const waiting = (db) => db.prepare("SELECT COUNT(*) AS n FROM file_lock_queue WHERE status = 'waiting'").get().n;

test('release by a queued waiter dequeues it and leaves the holder alone', (t) => {
  const db = makeDb(t);
  requestFileLock(db, 'a.js', '@holder');
  requestFileLock(db, 'a.js', '@waiter');
  assert.equal(waiting(db), 1);
  const res = releaseFileLock(db, 'a.js', '@waiter');
  assert.equal(res.success, true);
  assert.equal(res.dequeued, true);
  assert.equal(waiting(db), 0);
  assert.equal(db.prepare('SELECT locked_by FROM file_leases').get().locked_by, '@holder');
});

test('release by a stranger who is not queued is still not_holder', (t) => {
  const db = makeDb(t);
  requestFileLock(db, 'a.js', '@holder');
  const res = releaseFileLock(db, 'a.js', '@stranger');
  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_holder');
});
