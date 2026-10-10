/**
 * edit_shas (#4608): chemx patch/write record the sha1 of what they wrote in the coordination db.
 * Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { closeQuietly } from './team-db-readonly.js';
import { patchFile, writeFile } from '../patcher.js';
import { recordEditSha, lookupEditSha, sha1OfText } from './edit-shas.js';

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-edit-shas-'));
  const db = openIndexDb(root, { fresh: true });
  t.after(() => {
    closeQuietly(db);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
};

test('recordEditSha stores path, sha1, handle and time; lookup reads them back', (t) => {
  const root = makeProject(t);
  const file = path.join(root, 'a.txt');
  fs.writeFileSync(file, 'hello');
  assert.equal(recordEditSha(file, { cwd: root, handle: '@spec', now: 42 }), true);
  assert.deepEqual({ ...lookupEditSha(file, root) }, { path: file, sha1: sha1OfText('hello'), handle: '@spec', at: 42 });
});

test('lookup is null for an unrecorded path', (t) => {
  const root = makeProject(t);
  assert.equal(lookupEditSha(path.join(root, 'none.txt'), root), null);
});

test('writeFile and patchFile record the sha1 of the new content', (t) => {
  const root = makeProject(t);
  const file = path.join(root, 'b.txt');
  writeFile('b.txt', { content: 'one\n', cwd: root, agentId: '@spec', skipIndex: true, skipCheck: true });
  assert.equal(lookupEditSha(file, root).sha1, sha1OfText('one\n'));
  patchFile('b.txt', { targetContent: 'one', replacementContent: 'two', cwd: root, agentId: '@spec', skipIndex: true, skipCheck: true });
  const row = lookupEditSha(file, root);
  assert.equal(row.sha1, sha1OfText('two\n'));
  assert.equal(row.handle, '@spec');
});

test('a dry run records nothing', (t) => {
  const root = makeProject(t);
  writeFile('c.txt', { content: 'x', cwd: root, dryRun: true, skipIndex: true, skipCheck: true });
  assert.equal(lookupEditSha(path.join(root, 'c.txt'), root), null);
});