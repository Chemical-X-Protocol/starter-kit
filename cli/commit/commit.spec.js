/**
 * chemx commit (#2564): every refusal, the happy path, trailers, the index.lock retry, the task
 * activity event and --release. Temp git repos and temp team dbs only; the kit's own db and repo are
 * never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openIndexDb } from '../search-schema.js';
import { createTask } from '../team/team-db-tasks.js';
import { queryFeed } from '../team/team-db-feed.js';
import { requestFileLock, getFileLockStatus } from '../team/team-db-locks.js';
import { runCommit } from './commit-run.js';
import { gitWithRetry } from './commit-git.js';
import { parseCommitArgs } from './commit-args.js';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });
const write = (root, file, text) => fs.writeFileSync(path.join(root, file), text);

const cleanEnv = (overrides = {}) => {
  const env = { ...process.env };
  ['CHEMX_AGENT_ID', 'CHEMX_COAUTHOR', 'CLAUDE_SESSION_ID', 'CHEMX_SESSION_ID', 'CHEMX_PROJECT_ROOT'].forEach((key) => delete env[key]);
  return { ...env, CHEMX_AGENT_ID: '@spec-a', ...overrides };
};

const makeRepo = (t, { chemxrc } = {}) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Spec']);
  git(root, ['config', 'user.email', 'spec@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'base.txt', 'base\n');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '-q', '-m', 'init']);
  if (chemxrc) write(root, '.chemxrc', JSON.stringify(chemxrc));
  const db = openIndexDb(root);
  const task = createTask(db, { title: 'spec task' });
  return { root, db, taskId: task.id };
};

const run = (root, args, extra = {}) => runCommit(args, { cwd: root, env: cleanEnv(extra.env), sleep: async () => {}, ...extra });
const headMessage = (root) => git(root, ['log', '-1', '--format=%B']).stdout;
const headFiles = (root) => git(root, ['show', '--name-only', '--format=', 'HEAD']).stdout.split('\n').filter(Boolean);
const commitCount = (root) => Number(git(root, ['rev-list', '--count', 'HEAD']).stdout.trim());

test('refuses an empty file list, -a, --no-verify and unknown options, naming each', async (t) => {
  const { root, taskId } = makeRepo(t);
  const noFiles = await run(root, ['-m', `x (#${taskId})`]);
  const all = await run(root, ['-a', '-m', `x (#${taskId})`]);
  const skip = await run(root, ['base.txt', '--no-verify', '-m', `x (#${taskId})`]);
  const unknown = await run(root, ['base.txt', '--amend', '-m', `x (#${taskId})`]);
  assert.match(noFiles.refusals.join('\n'), /no files listed/);
  assert.match(all.refusals.join('\n'), /-a\/--all/);
  assert.match(skip.refusals.join('\n'), /--no-verify/);
  assert.match(unknown.refusals.join('\n'), /unknown option\(s\) --amend/);
  assert.equal(commitCount(root), 1);
});

test('refuses without a task id, with both task forms, and with an unknown task', async (t) => {
  const { root } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  const none = await run(root, ['a.txt', '-m', 'add a']);
  const both = await run(root, ['a.txt', '-m', 'add a', '--task=1', '--no-task=because']);
  const unknown = await run(root, ['a.txt', '-m', 'add a (#9999)']);
  assert.match(none.refusals.join('\n'), /no task id/);
  assert.match(both.refusals.join('\n'), /not both/);
  assert.match(unknown.refusals.join('\n'), /task #9999 was not found/);
  assert.equal(commitCount(root), 1);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout, '');
});

test('refuses a file that is neither tracked nor on disk, and one outside the repository', async (t) => {
  const { root, taskId } = makeRepo(t);
  const missing = await run(root, ['nope.txt', '-m', `x (#${taskId})`]);
  const outside = await run(root, ['../elsewhere.txt', '-m', `x (#${taskId})`]);
  assert.match(missing.refusals.join('\n'), /not tracked and not on disk: nope\.txt/);
  assert.match(outside.refusals.join('\n'), /outside this repository/);
});

test('refuses when unrelated paths are already staged, naming them, and leaves the index alone', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'other.txt', 'o\n');
  write(root, 'mine.txt', 'm\n');
  git(root, ['add', 'other.txt']);
  const result = await run(root, ['mine.txt', '-m', `add mine (#${taskId})`]);
  assert.equal(result.ok, false);
  assert.match(result.refusals.join('\n'), /already staged: other\.txt/);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout.trim(), 'other.txt');
});

test('refuses a file under another handle\'s live lease and commits nothing', async (t) => {
  const { root, db, taskId } = makeRepo(t);
  write(root, 'held.txt', 'h\n');
  requestFileLock(db, 'held.txt', '@spec-b', { cwd: root, purpose: '#77 editing' });
  const result = await run(root, ['held.txt', '-m', `add held (#${taskId})`]);
  assert.equal(result.ok, false);
  assert.match(result.refusals.join('\n'), /held\.txt: leased by @spec-b \(#77 editing\)/);
  assert.equal(commitCount(root), 1);
});

test('refuses when there is nothing to commit in the listed files', async (t) => {
  const { root, taskId } = makeRepo(t);
  const result = await run(root, ['base.txt', '-m', `nothing (#${taskId})`]);
  assert.equal(result.ok, false);
  assert.match(result.refusals.join('\n'), /nothing to commit/);
});

test('happy path: commits only the listed files (new and modified), reports sha, files, gate and task', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'new.txt', 'n\n');
  write(root, 'base.txt', 'changed\n');
  write(root, 'bystander.txt', 'b\n');
  const result = await run(root, ['new.txt', 'base.txt', '-m', `feat(x): add new (#${taskId})`, '-m', 'Body paragraph.']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(headFiles(root).sort(), ['base.txt', 'new.txt']);
  assert.equal(result.data.sha, git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim());
  assert.match(headMessage(root), /feat\(x\): add new \(#\d+\)\n\nBody paragraph\./);
  assert.equal(result.data.gate, 'no pre-commit hook is installed in this repository');
  assert.equal(result.data.task, `#${taskId}`);
  assert.match(git(root, ['status', '--short']).stdout, /\?\? bystander\.txt/);
  assert.deepEqual(result.lines.slice(0, 3).map((line) => line.split(':')[0]), ['sha', 'subject', 'files']);
});

test('--task is added to the subject when the message has no #id', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', 'add a', `--task=${taskId}`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(headMessage(root).split('\n')[0], `add a (#${taskId})`);
});

test('trailers: [skip ci] from config and Co-Authored-By from CHEMX_COAUTHOR; none are invented', async (t) => {
  const configured = makeRepo(t, { chemxrc: { commit: { skipCi: true } } });
  write(configured.root, 'a.txt', 'a\n');
  const withTrailers = await run(configured.root, ['a.txt', '-m', `add a (#${configured.taskId})`], { env: { CHEMX_COAUTHOR: 'Spec Author <spec@example.invalid>' } });
  assert.equal(withTrailers.ok, true, withTrailers.lines.join('\n'));
  assert.equal(headMessage(configured.root).split('\n')[0], `add a (#${configured.taskId}) [skip ci]`);
  assert.match(headMessage(configured.root), /Co-Authored-By: Spec Author <spec@example\.invalid>/);

  const plain = makeRepo(t);
  write(plain.root, 'b.txt', 'b\n');
  const without = await run(plain.root, ['b.txt', '-m', `add b (#${plain.taskId})`]);
  assert.equal(without.ok, true, without.lines.join('\n'));
  assert.doesNotMatch(headMessage(plain.root), /Co-Authored-By|skip ci/);
});

test('--no-task records the reason in the body and as an unattached feed event', async (t) => {
  const { root, db } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', 'chore: add a', '--no-task=one-off cleanup']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.match(headMessage(root), /No-Task: one-off cleanup/);
  const events = queryFeed(db, {}).filter((event) => event.event_type === 'commit');
  assert.equal(events.length, 1);
  assert.match(events[0].message, /no task: one-off cleanup/);
});

test('records the commit on the task: sha, subject and files', async (t) => {
  const { root, db, taskId } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`]);
  const events = queryFeed(db, { task_id: taskId }).filter((event) => event.event_type === 'commit');
  assert.equal(events.length, 1);
  assert.equal(events[0].author_id, '@spec-a');
  assert.equal(events[0].metadata.sha, result.data.sha);
  assert.deepEqual(events[0].metadata.files, ['a.txt']);
  assert.equal(events[0].metadata.subject, result.data.subject);
});

test('the pre-commit hook runs; its failure prints findings, exits non-zero in the result and commits nothing', async (t) => {
  const { root, taskId } = makeRepo(t);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "gate: 2 hazards in a.txt" >&2\nexit 1\n', { mode: 0o755 });
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.lines.join('\n'), /gate: 2 hazards in a\.txt/);
  assert.equal(commitCount(root), 1);
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout.trim(), 'a.txt');
});

test('the hook runs as the committer: it sees CHEMX_AGENT_ID from --as', async (t) => {
  const { root, taskId } = makeRepo(t);
  const seen = path.join(root, 'seen-handle.log');
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\necho "$CHEMX_AGENT_ID" > '${seen}'\nexit 0\n`, { mode: 0o755 });
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`, '--as=@spec-c'], { env: { CHEMX_AGENT_ID: '' } });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(fs.readFileSync(seen, 'utf-8').trim(), '@spec-c');
});

test('a passing pre-commit hook is reported as passed', async (t) => {
  const { root, taskId } = makeRepo(t);
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  write(root, 'a.txt', 'a\n');
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data.gate, 'pre-commit hook passed');
});

test('index.lock: a lock that clears is retried and the commit lands', async (t) => {
  const { root } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  git(root, ['add', 'a.txt']);
  const lock = path.join(root, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); fs.rmSync(lock, { force: true }); };
  const outcome = await gitWithRetry(root, ['commit', '-q', '-m', 'locked then free', '--', 'a.txt'], { sleep, delaysMs: [5, 10, 20] });
  assert.equal(outcome.status, 0, outcome.output);
  assert.equal(outcome.attempts, 2);
  assert.deepEqual(delays, [5]);
  assert.equal(outcome.lockedOut, false);
});

test('index.lock: a lock that stays held fails after bounded retries and says so', async (t) => {
  const { root, taskId } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
  const delays = [];
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`], { sleep: async (ms) => { delays.push(ms); }, delaysMs: [1, 2, 3] });
  assert.equal(result.ok, false);
  assert.deepEqual(delays, [1, 2, 3]);
  assert.match(result.lines.join('\n'), /Refused: git add failed/);
  assert.equal(commitCount(root), 1);
});

test('index.lock at commit time reports the attempts and the holder when it is unknown', async (t) => {
  const { root } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  git(root, ['add', 'a.txt']);
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
  const outcome = await gitWithRetry(root, ['commit', '-q', '-m', 'x', '--', 'a.txt'], { sleep: async () => {}, delaysMs: [1, 1] });
  assert.equal(outcome.lockedOut, true);
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.status === 0, false);
});

test('--release releases the committer\'s leases on the committed files only', async (t) => {
  const { root, db, taskId } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  write(root, 'keep.txt', 'k\n');
  requestFileLock(db, 'a.txt', '@spec-a', { cwd: root });
  requestFileLock(db, 'keep.txt', '@spec-a', { cwd: root });
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`, '--release']);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(result.data.released, ['a.txt']);
  assert.match(result.lines.join('\n'), /leases released: a\.txt/);
  assert.equal(getFileLockStatus(db, 'a.txt', { cwd: root }).lease, null);
  assert.equal(getFileLockStatus(db, 'keep.txt', { cwd: root }).lease.locked_by, '@spec-a');
});

test('without --release the committer keeps its leases', async (t) => {
  const { root, db, taskId } = makeRepo(t);
  write(root, 'a.txt', 'a\n');
  requestFileLock(db, 'a.txt', '@spec-a', { cwd: root });
  const result = await run(root, ['a.txt', '-m', `add a (#${taskId})`]);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(getFileLockStatus(db, 'a.txt', { cwd: root }).lease.locked_by, '@spec-a');
});

test('parseCommitArgs reads =value and spaced values and keeps unknown flags for refusal', () => {
  const parsed = parseCommitArgs(['a.js', 'b.js', '-m', 'one', '--message=two', '--task=#5', '--no-task', 'why', '--release', '--json', '--as=@x', '--bogus']);
  assert.deepEqual(parsed.files, ['a.js', 'b.js']);
  assert.deepEqual(parsed.messages, ['one', 'two']);
  assert.equal(parsed.taskId, '5');
  assert.equal(parsed.noTask, 'why');
  assert.equal(parsed.release && parsed.json, true);
  assert.equal(parsed.as, '@x');
  assert.deepEqual(parsed.unknown, ['--bogus']);
});
