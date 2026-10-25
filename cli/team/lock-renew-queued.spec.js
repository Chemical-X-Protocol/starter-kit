/**
 * `lock renew` by a handle that is queued for the file (#6758): the acquire and poll lines already say
 * `queued behind @holder` (#6747); the renew refusal says it too, with the position and the expiry,
 * instead of only "held by another agent". Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { handleLockCommand } from './team-commands-lock.js';
import { clockTime } from './lease-lapse.js';

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-renew-queued-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
  const db = openIndexDb(root, { fresh: true });
  handleLockCommand(db, ['a.js'], { as: '@spec-holder' }, false, root);
  return { root, db };
};

const captureStderr = (run) => {
  const original = process.stderr.write.bind(process.stderr);
  const exitCode = process.exitCode;
  let text = '';
  process.stderr.write = (chunk) => { text += String(chunk); return true; };
  try {
    const result = run();
    return { text, result };
  } finally {
    process.stderr.write = original;
    process.exitCode = exitCode;
  }
};

const renewAs = (db, root, handle, flags = {}) => captureStderr(() => handleLockCommand(db, ['renew', 'a.js'], { as: handle, ...flags }, true, root));

test('a queued waiter\'s renew says it is queued behind the holder, with the position and the expiry', (t) => {
  const { root, db } = makeProject(t);
  handleLockCommand(db, ['a.js'], { as: '@spec-first' }, false, root);
  handleLockCommand(db, ['a.js'], { as: '@spec-second' }, false, root);
  const expires = db.prepare('SELECT expires_at FROM file_leases WHERE file_path = ?').get('a.js').expires_at;

  const { text, result } = renewAs(db, root, '@spec-second');

  assert.equal(result.renewed, false);
  assert.equal(result.reason, 'not_holder');
  assert.equal(result.queued, true);
  assert.equal(result.position, 2);
  assert.match(text, /Renew refused: held by another agent; only the holder can renew \(held by @spec-holder\); you are queued behind it \(position 2, it expires \d\d:\d\d\)/);
  assert.ok(text.includes(clockTime(expires).slice(0, 5)), 'the expiry is the holder\'s lease expiry');
});

test('a handle that is not queued is refused as before, without a queue note', (t) => {
  const { root, db } = makeProject(t);

  const { text, result } = renewAs(db, root, '@spec-stranger');

  assert.equal(result.reason, 'not_holder');
  assert.equal(result.queued, undefined);
  assert.match(text, /Renew refused: held by another agent; only the holder can renew \(held by @spec-holder\)/);
  assert.doesNotMatch(text, /queued behind/);
});

test('the holder\'s own renew is unchanged', (t) => {
  const { root, db } = makeProject(t);
  handleLockCommand(db, ['a.js'], { as: '@spec-waiter' }, false, root);

  const { text, result } = renewAs(db, root, '@spec-holder');

  assert.equal(result.renewed, true);
  assert.equal(text, '');
});
