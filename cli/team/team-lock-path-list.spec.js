import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { handleLockCommand } from './team-commands-lock.js';

const setup = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lockpl-'));
  return { db, cwd };
};

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
