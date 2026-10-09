/**
 * Task CLI text: `task update` echoes the status it wrote (#1685), and titles may contain
 * words that look like flags via --title= or a `--` terminator (#1564).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { stripAnsi } from '../terminal.js';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-cli-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

// Captures CLI stdout synchronously; restored before the test runner writes again.
const captureStdout = (run) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }
  return stripAnsi(output);
};

test('task update: reopening a completed task echoes the written status, not "done"', (t) => {
  const root = makeProject(t);
  const task = runTeamCli(['task', 'add', 'Reopen me'], false, root);
  runTeamCli(['task', 'claim', String(task.id), '--as=@rev'], false, root);
  runTeamCli(['task', 'done', String(task.id), '--as=@rev', '--no-target-confirm'], false, root);

  const output = captureStdout(() => {
    runTeamCli(['task', 'update', String(task.id), '--status=in_progress', '--as=@rev'], true, root);
  });
  assert.match(output, new RegExp(`Updated task #${task.id} status to "in_progress"`));
  assert.doesNotMatch(output, /"done"|Verified|Unverified/);
});

test('task update: a completion still reports the gate outcome', (t) => {
  const root = makeProject(t);
  const task = runTeamCli(['task', 'add', 'Finish me'], false, root);
  runTeamCli(['task', 'claim', String(task.id), '--as=@rev'], false, root);
  const output = captureStdout(() => {
    runTeamCli(['task', 'update', String(task.id), '--status=done', '--as=@rev', '--no-target-confirm'], true, root);
  });
  assert.match(output, /to status "done" \(Unverified: no target_path specified/);
});

test('task add: --title= keeps words that start with --', (t) => {
  const root = makeProject(t);
  const task = runTeamCli(['task', 'add', '--title=G1: chemx build --command=<cmd> is ignored', '--sprint=s1'], false, root);
  assert.equal(task.title, 'G1: chemx build --command=<cmd> is ignored');
  assert.equal(task.sprint_tag, 's1');
});

test('task add: words after a -- terminator are title text, flags before it still apply', (t) => {
  const root = makeProject(t);
  const task = runTeamCli(['task', 'add', 'G1:', '--sprint=s1', '--', 'zero', '--test', 'runs', '--sprint=s2'], false, root);
  assert.equal(task.title, 'G1: zero --test runs --sprint=s2');
  assert.equal(task.sprint_tag, 's1');
});
