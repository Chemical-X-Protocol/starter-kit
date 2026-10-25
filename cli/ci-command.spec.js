/**
 * #6760 (K15): `chemx ci [<pr>|<branch>|<url>] [--wait]` reads a pull request's checks and merge state
 * through gh. Every spec stubs the gh runner (the one module that spawns gh) with canned replies
 * copied from real `gh pr checks --json` / `gh pr view --json` output; the last block runs the real
 * CLI against a fake `gh` script on PATH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCiArgs, runCi } from './ci-command.js';
import { findCommandSchema } from './commands-schema.js';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const STATES = { pass: 'SUCCESS', fail: 'FAILURE', pending: 'IN_PROGRESS', skipping: 'SKIPPED', cancel: 'CANCELLED' };
const START = '2026-10-25T20:57:19Z';
const DONE = '2026-10-25T20:57:38Z';
const NEVER = '0001-01-01T00:00:00Z';

const check = (name, bucket, extra = {}) => ({
  name, bucket, state: STATES[bucket], workflow: 'Gate', startedAt: START, completedAt: bucket === 'pending' ? NEVER : DONE,
  link: `https://github.com/o/r/actions/runs/1/job/${name.length}`, ...extra
});
const view = (extra = {}) => ({ number: 23, state: 'OPEN', url: 'https://github.com/o/r/pull/23', headRefName: 'fix/x', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', autoMergeRequest: null, reviewDecision: '', ...extra });
const ok = (value) => ({ ok: true, code: 0, stdout: JSON.stringify(value), stderr: '', missing: false });
const refused = (stderr, code = 1) => ({ ok: false, code, stdout: '', stderr, missing: false });

// Replies for `pr checks` and `pr view` are consumed in order; the last one repeats. Every call is recorded.
const makeGh = ({ checks, views = [ok(view())] }) => {
  const calls = [];
  const counters = { checks: 0, view: 0 };
  const next = (list, key) => list[Math.min(counters[key]++, list.length - 1)];
  const gh = (args) => {
    calls.push(args);
    const kind = args[1];
    return kind === 'checks' ? next(checks, 'checks') : next(views, 'view');
  };
  return { gh, calls };
};

const makeDeps = (gh, now = Date.parse('2026-10-25T20:57:36Z')) => {
  const out = [];
  const sleeps = [];
  let clock = now;
  return { out, sleeps, deps: { gh, write: (text) => out.push(text), clock: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } } };
};

const run = async (args, replies, now) => {
  const { gh, calls } = makeGh(replies);
  const { out, sleeps, deps } = makeDeps(gh, now);
  const result = await runCi(args, deps);
  return { result, calls, text: out.join(''), sleeps };
};

test('parseCiArgs: target, --repo, --wait, --timeout and --json in both value forms', () => {
  assert.deepEqual(parseCiArgs([]), { target: null, repo: null, wait: false, timeoutMs: 1800000, protection: false, json: false, error: null });
  const full = parseCiArgs(['23', '--repo', 'o/r', '--wait', '--timeout=90', '--json']);
  assert.deepEqual([full.target, full.repo, full.wait, full.timeoutMs, full.json, full.error], ['23', 'o/r', true, 90000, true, null]);
  assert.equal(parseCiArgs(['--repo=o/r']).repo, 'o/r');
  assert.equal(parseCiArgs(['--timeout', '5m']).timeoutMs, 300000);
  assert.equal(parseCiArgs(['#23']).target, '23');
  assert.equal(parseCiArgs(['fix/k15-ci']).target, 'fix/k15-ci');
  assert.equal(parseCiArgs(['https://github.com/o/r/pull/23']).target, 'https://github.com/o/r/pull/23');
});

test('parseCiArgs: a bad timeout, a second target, a missing value and mixed modes are errors', () => {
  assert.match(parseCiArgs(['--timeout=soon']).error, /--timeout/);
  assert.match(parseCiArgs(['1', '2']).error, /one pull request/);
  assert.match(parseCiArgs(['--repo']).error, /--repo needs a value/);
  assert.match(parseCiArgs(['--protection', '23']).error, /--protection reads the repository/);
  assert.match(parseCiArgs(['--protection', '--wait']).error, /--protection .*--wait/);
});

test('ci is a registered chemx command, so the guard treats it as one', () => {
  const entry = findCommandSchema('ci');
  assert.equal(entry.name, 'ci');
  for (const flag of ['--repo', '--wait', '--timeout', '--protection', '--json']) {
    assert.ok(entry.flags.some((f) => f.flag.startsWith(flag)), `schema lists ${flag}`);
  }
});

test('all checks pass: one line per check, the merge line, exit 0, and gh is asked for the fields it needs', async () => {
  const { result, calls, text } = await run(['23', '--repo', 'o/r'], { checks: [ok([check('Audit', 'pass'), check('Smoke Test', 'pass')])] });
  assert.equal(result.code, 0);
  const lines = text.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^pass\s+19s\s+Audit$/);
  assert.match(lines[1], /^pass\s+19s\s+Smoke Test$/);
  assert.match(lines[2], /^PR #23 open: merge state CLEAN, mergeable MERGEABLE, auto-merge off, review none$/);
  const [checksCall, viewCall] = calls;
  assert.deepEqual(checksCall.slice(0, 4), ['pr', 'checks', '23', '--repo']);
  assert.equal(checksCall[4], 'o/r');
  assert.equal(checksCall[5], '--json');
  assert.match(checksCall[6], /name/);
  assert.deepEqual(viewCall.slice(0, 3), ['pr', 'view', '23']);
  assert.match(viewCall[viewCall.indexOf('--json') + 1], /mergeStateStatus,mergeable,autoMergeRequest,reviewDecision|autoMergeRequest.*reviewDecision/);
});

test('a failing check exits 1 and its line carries the run link; a skipped check does not fail the run', async () => {
  const { result, text } = await run([], { checks: [ok([check('Audit', 'pass'), check('Smoke', 'fail'), check('Docs', 'skipping')])] });
  assert.equal(result.code, 1);
  assert.match(text, /^FAIL\s+19s\s+Smoke\s+https:\/\/github\.com\/o\/r\/actions\/runs\/1\/job\/5$/m);
  assert.match(text, /^skipped\s+.*Docs$/m);
  const clean = await run([], { checks: [ok([check('Docs', 'skipping')])] });
  assert.equal(clean.result.code, 0);
});

test('a cancelled check counts as a failure', async () => {
  const { result, text } = await run([], { checks: [ok([check('Audit', 'cancel')])] });
  assert.equal(result.code, 1);
  assert.match(text, /^cancel\s+/m);
});

test('a pending check exits 3 and shows how long it has been running', async () => {
  const { result, text } = await run([], { checks: [ok([check('Audit', 'pass'), check('Smoke', 'pending')])] });
  assert.equal(result.code, 3);
  assert.match(text, /^pending\s+17s\+\s+Smoke$/m);
  const queued = await run([], { checks: [ok([check('Smoke', 'pending', { startedAt: NEVER })])] });
  assert.match(queued.text, /^pending\s+queued\s+Smoke$/m);
});

test('no checks reported (gh exits 1 with a message, or answers an empty list) says so with the merge state and exits 3', async () => {
  const bare = await run(['16'], { checks: [refused("no checks reported on the 'fix/k5-commit-board' branch")] });
  assert.equal(bare.result.code, 3);
  assert.match(bare.text, /^no checks reported$/m);
  assert.match(bare.text, /^PR #23 open: merge state CLEAN/m);
  const empty = await run(['16'], { checks: [ok([])] });
  assert.equal(empty.result.code, 3);
  assert.match(empty.text, /^no checks reported$/m);
});

test('the merge line names auto-merge, the review decision and a closed PR', async () => {
  const views = [ok(view({ state: 'MERGED', mergeStateStatus: 'UNKNOWN', mergeable: 'UNKNOWN', autoMergeRequest: { mergeMethod: 'SQUASH' }, reviewDecision: 'APPROVED' }))];
  const { text } = await run([], { checks: [ok([check('Audit', 'pass')])], views });
  assert.match(text, /^PR #23 merged: merge state UNKNOWN, mergeable UNKNOWN, auto-merge on \(squash\), review APPROVED$/m);
});

test('gh missing, a PR gh cannot find and a view that fails are exit 2 with gh\'s own words', async () => {
  const missing = await run([], { checks: [{ ok: false, code: null, stdout: '', stderr: 'spawn gh ENOENT', missing: true }] });
  assert.equal(missing.result.code, 2);
  assert.match(missing.result.message, /gh is not installed/);
  const absent = await run(['99999'], { checks: [ok([check('Audit', 'pass')])], views: [refused('GraphQL: Could not resolve to a PullRequest with the number of 99999. (repository.pullRequest)')] });
  assert.equal(absent.result.code, 2);
  assert.match(absent.result.message, /Could not resolve to a PullRequest/);
  const broken = await run([], { checks: [refused('HTTP 502: Bad Gateway')] });
  assert.equal(broken.result.code, 2);
  assert.match(broken.result.message, /Bad Gateway/);
});

test('--json prints one object with the verdict, the checks and the merge facts', async () => {
  const { result, text } = await run(['--json'], { checks: [ok([check('Audit', 'pass'), check('Smoke', 'fail')])] });
  const parsed = JSON.parse(text);
  assert.equal(result.code, 1);
  assert.equal(parsed.verdict, 'fail');
  assert.equal(parsed.pr.number, 23);
  assert.deepEqual(parsed.checks.map((c) => [c.name, c.bucket, c.durationMs]), [['Audit', 'pass', 19000], ['Smoke', 'fail', 19000]]);
  assert.deepEqual(parsed.merge, { mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', autoMerge: null, reviewDecision: '' });
});

test('--wait polls every 30 s, prints the full block once and then only what changed, and ends 0 when green', async () => {
  const first = ok([check('Audit', 'pending'), check('Smoke', 'pending')]);
  const second = ok([check('Audit', 'pass'), check('Smoke', 'pending')]);
  const third = ok([check('Audit', 'pass'), check('Smoke', 'pass')]);
  const { result, text, sleeps } = await run(['--wait'], { checks: [first, first, second, third] });
  assert.equal(result.code, 0);
  assert.deepEqual(sleeps, [30000, 30000, 30000]);
  const lines = text.trimEnd().split('\n');
  assert.equal(lines.filter((l) => /Audit$/.test(l)).length, 2, 'Audit printed pending, then pass');
  assert.equal(lines.filter((l) => /Smoke$/.test(l)).length, 2, 'Smoke printed pending, then pass');
  assert.equal(lines.filter((l) => l.startsWith('PR #23')).length, 1, 'an unchanged merge line prints once');
});

test('--wait exits 1 as soon as a check fails, without waiting for the rest', async () => {
  const running = ok([check('Audit', 'fail'), check('Smoke', 'pending')]);
  const { result, sleeps } = await run(['--wait'], { checks: [ok([check('Audit', 'pending'), check('Smoke', 'pending')]), running] });
  assert.equal(result.code, 1);
  assert.deepEqual(sleeps, [30000]);
});

test('--wait with no checks yet keeps polling and prints the notice once; checks that then appear are read', async () => {
  const { result, text, sleeps } = await run(['--wait'], { checks: [refused("no checks reported on the 'x' branch"), refused("no checks reported on the 'x' branch"), ok([check('Audit', 'pass')])] });
  assert.equal(result.code, 0);
  assert.equal(sleeps.length, 2);
  assert.equal((text.match(/no checks reported/g) ?? []).length, 1);
  assert.match(text, /pass\s+19s\s+Audit/);
});

test('--wait --timeout ends 3 with the checks still pending named', async () => {
  const { result, text, sleeps } = await run(['--wait', '--timeout=60'], { checks: [ok([check('Smoke', 'pending')])] });
  assert.equal(result.code, 3);
  assert.deepEqual(sleeps, [30000, 30000]);
  assert.match(text, /timed out after 60s.*Smoke/);
});

test('--wait --json prints nothing until the end, then one object', async () => {
  const { text } = await run(['--wait', '--json'], { checks: [ok([check('Smoke', 'pending')]), ok([check('Smoke', 'pass')])] });
  assert.equal(JSON.parse(text).verdict, 'pass');
});

// The real CLI, through the router, with a fake gh first on PATH.
const fakeGh = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-fake-gh-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = [
    '#!/bin/sh',
    'echo "$@" >> "$FAKE_GH_LOG"',
    'if [ "$2" = "checks" ]; then',
    `  echo '[{"name":"Audit","bucket":"pass","state":"SUCCESS","startedAt":"${START}","completedAt":"${DONE}","link":"https://x/1"}]'`,
    'else',
    `  echo '${JSON.stringify(view())}'`,
    'fi'
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'gh'), `${script}\n`, { mode: 0o755 });
  return dir;
};

test('cli: chemx ci runs through the router and the real gh runner, and --help prints its usage', (t) => {
  const bin = fakeGh(t);
  const log = path.join(bin, 'calls.log');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_LOG: log, CHEMX_PROJECT_ROOT: '' };
  const ran = spawnSync(process.execPath, [CLI, 'ci', '23', '--repo', 'o/r'], { cwd: bin, encoding: 'utf8', env });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /^pass\s+19s\s+Audit$/m);
  assert.match(ran.stdout, /^PR #23 open: merge state CLEAN/m);
  assert.match(fs.readFileSync(log, 'utf8'), /pr checks 23 --repo o\/r --json/);
  const help = spawnSync(process.execPath, [CLI, 'ci', '--help'], { cwd: bin, encoding: 'utf8', env });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /chemx ci/);
  assert.match(help.stdout, /--protection/);
});
