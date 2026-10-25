/**
 * Every refusal of a `chemx team task` action exits 1 (K1b, #6765): a script that tests `$?` cannot tell a
 * refusal from a success otherwise. A write that lands exits 0 and prints nothing to stderr.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { runCliCaptured } from './cli-exit-fixture.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-exit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = runTeamCli(['task', 'add', 'exit subject', '--as=@orch'], false, root);
  return { root, id: task.id };
};

test('a refusal prints the reason and exits 1', (t) => {
  const { root, id } = makeBoard(t);
  const refusals = [
    { name: 'list --needs with a bad tier', args: ['list', '--needs=giant'], text: /needs/i },
    { name: 'show with no id', args: ['show'], text: /Task ID required/ },
    { name: 'show of a task that does not exist', args: ['show', '9999'], text: /not found/ },
    { name: 'brief with no id', args: ['brief'], text: /Task ID required/ },
    { name: 'comment with no id', args: ['comment'], text: /Task ID required/ },
    { name: 'comment with no message', args: ['comment', String(id)], text: /Message required/ },
    { name: 'claim --ignore-deps with no reason', args: ['claim', String(id), '--ignore-deps'], text: /A reason is required/ },
    { name: 'add with a bad --needs', args: ['add', 'x', '--needs=giant'], text: /needs/i },
    { name: 'add with a bad --kind', args: ['add', 'x', '--kind=nope'], text: /kind/i },
    { name: 'add with a target outside the board', args: ['add', 'x', '--target=../../outside'], text: /./ },
    { name: 'set-target with no path', args: ['set-target', String(id)], text: /Usage: chemx team task set-target/ },
    { name: 'set-files with no id', args: ['set-files'], text: /Usage: chemx team task set-files/ },
    { name: 'set-files with a file outside the root', args: ['set-files', String(id), '../../outside.js'], text: /outside the project root/ },
    { name: 'trace with a bad permalink', args: ['trace', String(id), 'not-a-permalink'], text: /Invalid traceability permalink/ },
    { name: 'vds-slot with no id', args: ['vds-slot'], text: /./ },
    { name: 'an unknown action', args: ['frobnicate'], text: /Unknown task action/ }
  ];
  for (const { name, args, text } of refusals) {
    const run = runCliCaptured(root, ['task', ...args, '--as=@orch']);
    assert.equal(run.exitCode, 1, `${name} exits 1`);
    assert.match(run.err, text, `${name} says why`);
  }
});

test('a refusal over the library API (no CLI) sets no exit code and writes nothing to stderr', (t) => {
  const { root } = makeBoard(t);
  const savedExitCode = process.exitCode;
  const realErr = process.stderr.write;
  const written = [];
  process.exitCode = undefined;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    const res = runTeamCli(['task', 'show'], false, root);
    assert.equal(res.error, 'taskId required');
    assert.equal(process.exitCode, undefined);
    assert.deepEqual(written, []);
  } finally {
    process.stderr.write = realErr;
    process.exitCode = savedExitCode;
  }
});

test('a write that lands exits 0 and prints nothing to stderr', (t) => {
  const { root, id } = makeBoard(t);
  const lands = [
    ['show', String(id)],
    ['comment', String(id), 'a note'],
    ['set-files', String(id)],
    ['update', String(id), 'review'],
    ['list', '--titles']
  ];
  for (const args of lands) {
    const run = runCliCaptured(root, ['task', ...args, '--as=@orch']);
    assert.equal(run.exitCode, 0, `${args.join(' ')}: ${run.err}`);
    assert.equal(run.err, '');
  }
});
