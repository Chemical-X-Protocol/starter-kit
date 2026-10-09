// --help/-h on subcommands without their own help returns help before any db is opened or event posted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';

const makeEmptyDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-help-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

for (const sub of ['post', 'dm', 'inbox', 'feed', 'handoff']) {
  for (const flag of ['--help', '-h']) {
    test(`team ${sub} ${flag} returns help and opens no db`, (t) => {
      const dir = makeEmptyDir(t);
      const result = runTeamCli([sub, flag], false, dir);
      assert.equal(result.help, true);
      assert.equal(fs.existsSync(path.join(dir, '.chemx')), false);
    });
  }
}
