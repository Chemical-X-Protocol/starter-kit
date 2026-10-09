/**
 * #2561 review fixes: the task text of a two-turn relay, per-invocation commit task ids, and shell writes
 * that share a line with a scratch command. Pure functions on in-memory input.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTranscriptCalls } from './audit-run-calls.js';
import { invocationsOf } from './audit-run-invocations.js';
import { commitsWithoutTask } from './audit-run-protocol.js';
import { shellWritesOf } from './audit-run-bypass.js';

const turn = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const REPO = '/work/repo';

const invsOf = (command) => invocationsOf({ name: 'Bash', at: 1, cwd: REPO, input: { command } });
const commitsOf = (command) => commitsWithoutTask(invsOf(command));
const writesOf = (command) => invsOf(command).flatMap((inv) => shellWritesOf(inv, [REPO], '/home/nobody'));

test('task text: the computed task turn wins over the relayed request that mentions it', () => {
  const relay = turn('[Workflow harness - user request] the user said: see the computed task text that follows');
  const task = turn('[Workflow harness - computed task] You are @a. Task #42 File: cli/x.js');
  const { taskText } = readTranscriptCalls(`${relay}\n${task}\n`);
  assert.match(taskText, /#42/);
  assert.doesNotMatch(taskText, /user said/);
});

test('commits: --help, --task=N, --task N, --no-task and #N in the commit own words are exempt', () => {
  assert.equal(commitsOf('chemx commit --help').length, 0);
  assert.equal(commitsOf('chemx commit a.js --task=12 -m "fix"').length, 0);
  assert.equal(commitsOf('chemx commit a.js --task 12 -m "fix"').length, 0);
  assert.equal(commitsOf('chemx commit a.js --no-task=chore -m "fix"').length, 0);
  assert.equal(commitsOf('chemx commit a.js -m "fix (#12)"').length, 0);
  assert.equal(commitsOf('chemx commit a.js -m "fix"').length, 1);
});

test('commits: a #id in another segment does not hide a task-less commit, and one line counts once', () => {
  assert.equal(commitsOf('echo "#12" && chemx commit a.js -m fix').length, 1);
  assert.equal(commitsOf('chemx commit a.js -m one && chemx commit b.js -m two').length, 1);
});

test('shell writes: a repo write beside a scratch redirect is still counted', () => {
  assert.equal(writesOf('sed -i s/a/b/ cli/foo.js').length, 1);
  assert.equal(writesOf('sed -i s/a/b/ cli/foo.js; echo done > /tmp/log').length, 1);
  assert.equal(writesOf('sed -i s/a/b/ cli/foo.js && chemx verify 2>&1 | tee /tmp/v.log').length, 1);
  assert.equal(writesOf('echo done > /tmp/log').length, 0);
});
