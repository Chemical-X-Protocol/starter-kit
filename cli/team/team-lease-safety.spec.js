/**
 * Leases: status and dashboard reads never delete them, and cleanup never removes a lease
 * another connection was granted in between (finding lease-clobbered-by-status-read).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, getFileLockStatus, cleanExpiredLeases, promoteNextWaiter } from './team-db-locks.js';
import { getSwarmStatus } from './team-db.js';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const expireLease = (db, file) => db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - 1000, file);

test('lease reads: getFileLockStatus reports an expired lease without deleting it', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@a', { cwd: root });
  expireLease(db, 'src/a.js');

  const status = getFileLockStatus(db, 'src/a.js', { cwd: root });
  assert.equal(status.lease, null, 'an expired lease is not reported as held');
  assert.equal(status.expiredLease.locked_by, '@a');
  assert.equal(status.expiredLease.expired, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM file_leases').get().c, 1, 'the read must not delete the row');
});

test('lease reads: getSwarmStatus counts expired leases separately and deletes nothing', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/live.js', '@live', { cwd: root });
  requestFileLock(db, 'src/old.js', '@old', { cwd: root });
  expireLease(db, 'src/old.js');

  const status = getSwarmStatus(db);
  assert.equal(status.locks.active, 1);
  assert.equal(status.locks.expired, 1);
  assert.deepEqual(status.locks.leases.map((l) => l.file_path), ['src/live.js']);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM file_leases').get().c, 2);
});

test('lease cleanup: a lease granted between the scan and the delete survives', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@a', { cwd: root, ttlMs: 1 });
  expireLease(db, 'src/a.js');

  // A second connection whose scan is interleaved with process B acquiring the same file.
  const raw = new DatabaseSync(path.join(root, '.chemx', 'index.db'));
  t.after(() => raw.close());
  let bGranted = null;
  const interleaved = new Proxy(raw, {
    get(target, key) {
      if (key !== 'prepare') {
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (sql) => {
        const statement = target.prepare(sql);
        const isLeaseScan = sql.startsWith('SELECT * FROM file_leases') && bGranted === null;
        if (!isLeaseScan) return statement;
        return {
          all: (...params) => {
            const rows = statement.all(...params);
            bGranted = requestFileLock(db, 'src/a.js', '@b', { cwd: root }).granted;
            return rows;
          }
        };
      };
    }
  });

  cleanExpiredLeases(interleaved);
  assert.equal(bGranted, true, 'B acquires the expired file');
  const lease = db.prepare('SELECT locked_by FROM file_leases WHERE file_path = ?').get('src/a.js');
  assert.equal(lease?.locked_by, '@b', "B's fresh lease must not be deleted by the stale scan");
});

test('lease promotion: promoting a waiter never overwrites a lease someone else holds', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@holder', { cwd: root });
  requestFileLock(db, 'src/a.js', '@waiter', { cwd: root });

  const promoted = promoteNextWaiter(db, 'src/a.js');
  assert.equal(promoted, null);
  assert.equal(getFileLockStatus(db, 'src/a.js', { cwd: root }).lease.locked_by, '@holder');
  assert.equal(getFileLockStatus(db, 'src/a.js', { cwd: root }).waiters.length, 1, 'the waiter keeps its place');
});
