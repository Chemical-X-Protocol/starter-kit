// --help/-h on subcommands without their own help returns help before any db is opened or event posted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { findCommandSchema } from '../commands-schema.js';

const makeEmptyDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-team-help-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

for (const sub of ['post', 'dm', 'inbox', 'feed', 'handoff', 'audit-run']) {
  for (const flag of ['--help', '-h']) {
    test(`team ${sub} ${flag} returns help and opens no db`, (t) => {
      const dir = makeEmptyDir(t);
      const result = runTeamCli([sub, flag], false, dir);
      assert.equal(result.help, true);
      assert.equal(fs.existsSync(path.join(dir, '.chemx')), false);
    });
  }
}

for (const argv of [['task', 'add'], ['task', 'list'], ['lock', 'acquire'], ['dispatch', 'run']]) {
  for (const flag of ['--help', '-h']) {
    test(`team ${argv.join(' ')} ${flag} creates no .chemx dir`, (t) => {
      const dir = makeEmptyDir(t);
      runTeamCli([...argv, flag], false, dir);
      assert.deepEqual(fs.readdirSync(dir), []);
    });
  }
}

for (const sub of ['task', 'lock', 'unlock', 'dispatch']) {
  for (const flag of ['--help', '-h']) {
    test(`team ${sub} ${flag} prints help and creates no .chemx dir`, (t) => {
      const dir = makeEmptyDir(t);
      runTeamCli([sub, flag], false, dir);
      assert.deepEqual(fs.readdirSync(dir), []);
    });
  }
}

// What `task --help` and `team --help` print, with colours stripped.
const captureHelp = (t, argv) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    runTeamCli(argv, true, makeEmptyDir(t));
  } finally {
    process.stdout.write = originalWrite;
  }
  return output.replace(/\x1b\[[0-9;]*m/g, '');
};

test('task help names the output-diet flags and the one-line acks (K4)', (t) => {
  const card = captureHelp(t, ['task', '--help']);
  for (const word of ['--brief', 'comment N posted', '#<id> added']) {
    assert.ok(card.includes(word), `task help omits ${word}`);
  }
});

test('team help names the feed filters and the status switches (K4)', (t) => {
  const card = captureHelp(t, ['--help']);
  for (const word of ['--from', '--type=lock|status|post|task', '--since', '--full', '--oneline', '--mine', '--blockers']) {
    assert.ok(card.includes(word), `team help omits ${word}`);
  }
});

test('chemx team --help (the schema entry) lists the feed, show and status switches (K4)', () => {
  const flags = findCommandSchema('team').flags.map((entry) => entry.flag.split('=')[0]);
  for (const flag of ['--from', '--type', '--since', '--full', '--brief', '--mine', '--blockers']) {
    assert.ok(flags.includes(flag), `team schema omits ${flag}`);
  }
});
