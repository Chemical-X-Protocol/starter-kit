import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPostEdit } from './claude-post-edit.js';
import { parsePorcelain } from './out-of-band-edits.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempRepo = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-oob-')));
  created.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;\n');
  return dir;
};
const bash = (root, command, logged) => runPostEdit(
  { tool_name: 'Bash', tool_input: { command }, cwd: root },
  { CLAUDE_PROJECT_DIR: root, CHEMX_AGENT_ID: '@spec' },
  { log: async (entry) => { logged.push(entry); } },
);
// Write a file and stamp its mtime a few seconds ahead so it is clearly newer than the record.
const put = (file, text) => {
  fs.writeFileSync(file, text);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
};

test('parsePorcelain lists dirty paths, follows renames, skips deletions', () => {
  assert.deepEqual(parsePorcelain(' M a.js\0?? b.js\0R  new.js\0old.js\0 D gone.js\0'), ['a.js', 'b.js', 'new.js']);
});

test('the first Bash call only records a baseline and flags nothing', async () => {
  const root = tempRepo();
  const logged = [];
  assert.equal(await bash(root, 'node build.mjs', logged), null);
  assert.equal(logged.length, 0);
});

test('a node script write after the baseline is flagged and logged as out_of_band_edit', async () => {
  const root = tempRepo();
  const logged = [];
  await bash(root, 'ls', logged);
  put(path.join(root, 'a.js'), 'export const a = 2;\n');
  put(path.join(root, 'b.js'), 'export const b = 1;\n');
  const output = await bash(root, 'node /tmp/split.mjs', logged);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /a\.js, b\.js were changed by a Bash call that was not a chemx command/);
  assert.match(context, /chemx patch/);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].rule, 'out_of_band_edit');
  assert.equal(logged[0].handle, '@spec');
  assert.equal(await bash(root, 'ls', logged), null, 'the same change is not flagged twice');
});

test('a chemx command that writes is not flagged', async () => {
  const root = tempRepo();
  const logged = [];
  await bash(root, 'ls', logged);
  put(path.join(root, 'a.js'), 'export const a = 3;\n');
  assert.equal(await bash(root, 'chemx patch a.js --target=x --replacement=y', logged), null);
  assert.equal(logged.length, 0);
  assert.equal(await bash(root, 'ls', logged), null, 'recorded as seen after the chemx call');
});

test('files outside the repo, ignored files and non-write extensions are not flagged', async () => {
  const root = tempRepo();
  const logged = [];
  await bash(root, 'ls', logged);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-oob-out-'));
  created.push(outside);
  fs.writeFileSync(path.join(outside, 'x.js'), 'x\n');
  put(path.join(root, 'notes.bin'), 'x\n');
  assert.equal(await bash(root, 'node /tmp/other.mjs', logged), null);
  assert.equal(logged.length, 0);
});

test('a directory that is not a git repo produces nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-oob-nogit-'));
  created.push(dir);
  const logged = [];
  assert.equal(await bash(dir, 'ls', logged), null);
});
