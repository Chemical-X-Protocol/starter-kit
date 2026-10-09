/**
 * One lock decision for every mutation path: patch/write (write-lock-guard) and
 * applyEdits (edit-locks, used by autofix, explode and the mutators) must agree on
 * which lease blocks a file, whatever the caller's cwd or the lease's key form.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from './team-db-locks.js';
import { findBlockingLease } from './write-lock-guard.js';
import { findForeignLease } from '../edit-locks.js';
import { applyEdits } from '../apply-edits.js';

const makeProject = (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lock-parity-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"lock-parity-fixture"}\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  return { root, sub: path.join(root, 'src'), abs: path.join(root, 'src/a.js'), db: openIndexDb(root, { fresh: true }) };
};

const decisions = (abs, cwd, agentId) => ({
  guard: findBlockingLease(abs, cwd, agentId)?.locked_by ?? null,
  edits: findForeignLease(cwd, abs, agentId)?.lockedBy ?? null
});

test('a project-root lease blocks both paths from the root and from a subdirectory', (t) => {
  const { root, sub, abs, db } = makeProject(t);
  requestFileLock(db, 'a.js', '@dave', { cwd: sub });
  for (const cwd of [root, sub]) assert.deepEqual(decisions(abs, cwd, '@bob'), { guard: '@dave', edits: '@dave' });
  assert.deepEqual(decisions(abs, sub, '@dave'), { guard: null, edits: null });
});

test('a legacy cwd-relative lease row blocks applyEdits as it blocks patch/write', (t) => {
  const { sub, abs, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@dave', { cwd: path.dirname(sub) });
  db.prepare("UPDATE file_leases SET file_path = 'a.js' WHERE file_path = 'src/a.js'").run();
  assert.deepEqual(decisions(abs, sub, '@bob'), { guard: '@dave', edits: '@dave' });
  assert.throws(() => applyEdits([{ path: 'a.js', content: 'export const a = 2;\n' }], { cwd: sub, agentId: '@bob' }), /locked by @dave/);
  assert.equal(fs.readFileSync(abs, 'utf-8'), 'export const a = 1;\n');
});
