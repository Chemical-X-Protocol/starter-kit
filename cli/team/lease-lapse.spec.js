/**
 * Visible lapses (#2493): release, acquire and edit say what happened to a lapsed lease instead of a
 * bare not_holder. Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, releaseFileLock, cleanExpiredLeases } from './team-db-locks.js';
import { handleLockCommand, handleUnlockCommand } from './team-commands-lock.js';
import { applyEdits, EditRefusedError } from '../apply-edits.js';
import { clockTime } from './lease-lapse.js';

const CLOCK = '\\d\\d:\\d\\d:\\d\\d';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-lapse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const lapse = (db, file, minutesAgo = 2) => {
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - minutesAgo * 60000, file);
};

const captureStdout = (run) => {
  const original = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stdout.write = (chunk) => { text += String(chunk); return true; };
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
  return text;
};

test('release of a lapsed lease nobody took says when it expired and that nobody holds it', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js', 3);
  cleanExpiredLeases(db);

  const res = releaseFileLock(db, 'src/a.js', '@spec-a', { cwd: root });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'not_holder');
  assert.match(res.message, new RegExp(`^lease on src/a\\.js expired at ${CLOCK} \\(3 min ago\\); nobody holds it now$`));
});

test('release of a lapsed lease someone else took says who holds it and since when', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  const taken = requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });
  assert.equal(taken.granted, true);

  const res = releaseFileLock(db, 'src/a.js', '@spec-a', { cwd: root });

  assert.equal(res.success, false);
  assert.match(res.message, new RegExp(`expired at ${CLOCK} \\(2 min ago\\); now held by @spec-b since ${CLOCK}$`));
  assert.equal(res.heldBy, '@spec-b');
});

test('release by a handle that never held the file says so without inventing a lapse', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });

  const held = releaseFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  assert.match(held.message, /^you do not hold a lease on src\/a\.js; it is now held by @spec-b since /);
  assert.equal(held.lapse, undefined);

  const none = releaseFileLock(db, 'src/zzz.js', '@spec-a', { cwd: root });
  assert.equal(none.message, 'you do not hold a lease on src/zzz.js, and nobody else does');
});

test('an acquire or release after a re-acquire does not report the old lapse', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  cleanExpiredLeases(db);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  assert.equal(releaseFileLock(db, 'src/a.js', '@spec-a', { cwd: root }).success, true);

  const res = releaseFileLock(db, 'src/a.js', '@spec-a', { cwd: root });

  assert.equal(res.lapse, undefined, 'a release after the re-acquire cancels the lapse record');
});

test('lock release on the CLI prints the lapse sentence', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  cleanExpiredLeases(db);
  const stderr = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    handleUnlockCommand(db, ['src/a.js'], { as: '@spec-a' }, true, root);
  } finally {
    process.stderr.write = original;
  }
  assert.match(stderr.join(''), /Unlock failed: lease on src\/a\.js expired at .*nobody holds it now/);
});

test('acquire prints the expiry time and that chemx activity renews it', (t) => {
  const { root, db } = makeProject(t);
  const out = captureStdout(() => handleLockCommand(db, ['acquire', 'src/a.js'], { as: '@spec-a' }, true, root));
  const expiresAt = db.prepare('SELECT expires_at FROM file_leases WHERE file_path = ?').get('src/a.js').expires_at;

  assert.ok(out.includes(`It expires at ${clockTime(expiresAt)}.`), out);
  assert.match(out, /Any chemx command run as this handle extends it to 5 minutes from then; with no chemx activity it lapses\./);
});

test('acquire after a lapse says the earlier lease expired', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  cleanExpiredLeases(db);

  const res = requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  assert.equal(res.granted, true);
  assert.ok(res.previousLapse.expiredAt < Date.now());

  const text = captureStdout(() => handleLockCommand(db, ['acquire', 'src/a.js'], { as: '@spec-a' }, true, root));
  assert.ok(text.includes('Acquired lock'), 'a renewed acquire by the holder still succeeds');
});

test('an edit by the former holder of a lapsed lease whose row is still there re-acquires it and says so', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js', 4);

  const result = applyEdits([{ path: 'src/a.js', content: 'export const a = 2;\n' }], { cwd: root, agentId: '@spec-a' });

  assert.equal(result.leaseNotes.length, 1);
  assert.match(result.leaseNotes[0], new RegExp(`^lease on src/a\\.js expired at ${CLOCK} \\(4 min ago\\); nobody had taken it, so this edit re-acquired it until ${CLOCK}$`));
  const row = db.prepare('SELECT locked_by, expires_at FROM file_leases WHERE file_path = ?').get('src/a.js');
  assert.equal(row.locked_by, '@spec-a');
  assert.ok(row.expires_at > Date.now(), 'the lease is live again');
});

test('an edit by the former holder re-acquires a lease cleanup already deleted', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  cleanExpiredLeases(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM file_leases').get().c, 0);

  const result = applyEdits([{ path: 'src/a.js', content: 'export const a = 3;\n' }], { cwd: root, agentId: '@spec-a' });

  assert.equal(result.leaseNotes.length, 1);
  assert.equal(db.prepare('SELECT locked_by FROM file_leases WHERE file_path = ?').get('src/a.js').locked_by, '@spec-a');
});

test('an edit on a lapsed lease someone else took is refused, never re-acquired', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  lapse(db, 'src/a.js');
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });

  assert.throws(
    () => applyEdits([{ path: 'src/a.js', content: 'export const a = 4;\n' }], { cwd: root, agentId: '@spec-a' }),
    EditRefusedError
  );
  assert.equal(db.prepare('SELECT locked_by FROM file_leases WHERE file_path = ?').get('src/a.js').locked_by, '@spec-b');
});

test('an edit by a handle that never held the file adds no lease note', (t) => {
  const { root, db } = makeProject(t);
  const result = applyEdits([{ path: 'src/a.js', content: 'export const a = 5;\n' }], { cwd: root, agentId: '@spec-a' });

  assert.equal(result.leaseNotes, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM file_leases').get().c, 0);
});
