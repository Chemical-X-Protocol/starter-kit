// The record a chemx test run leaves, and `chemx wait --job=<pid>` (task #6772).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeJobRecord, readJobRecord, jobSummary, isJobRunning } from './job-record.js';
import { runWait, parseWaitArgs } from './wait-command.js';
import { findCommandSchema } from './commands-schema.js';
import { SPEC, withProject } from './test-kit-fixture.js';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-jobs-'));
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

test('job record: written by pid, read back, and swept when a day old', () => {
  const dir = tempDir();
  try {
    assert.equal(writeJobRecord({ command: 'chemx test a', status: 'pass', exitCode: 0, summary: '3 passed' }, { dir, pid: 41 }), true);
    const old = path.join(dir, '40.json');
    fs.writeFileSync(old, '{}');
    const longAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(old, longAgo, longAgo);
    writeJobRecord({ command: 'chemx test b', status: 'fail', exitCode: 1, summary: '1 failed' }, { dir, pid: 42 });
    assert.equal(fs.existsSync(old), false, 'a record from two days ago is swept');
    assert.deepEqual(readJobRecord(41, { dir }).summary, '3 passed');
    assert.equal(readJobRecord(42, { dir }).exitCode, 1);
    assert.equal(readJobRecord(43, { dir }), null, 'no record, no throw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('job record: an unwritable directory never throws', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'file'), '');
    assert.equal(writeJobRecord({ status: 'pass' }, { dir: path.join(dir, 'file', 'inside') }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('job record: the summary line says how the run ended in plain text', () => {
  assert.equal(jobSummary({ status: 'pass', passed: 12, failed: 0, skipped: 2 }), '12 passed, 2 skipped');
  assert.equal(jobSummary({ status: 'fail', passed: 5, failed: 2, skipped: 0, executionError: 'boom\nsecond' }), '5 passed, 2 failed (boom)');
  assert.equal(jobSummary({ status: 'inconclusive', passed: 0, failed: 0, reason: 'NO_TESTS_RAN', detail: 'no changed files vs HEAD' }), '0 passed (no changed files vs HEAD)');
});

test('job record: a zombie is not running, a live process is, a dead pid is not', async () => {
  assert.equal(isJobRunning(1234, { alive: () => true, state: () => 'Z' }), false);
  assert.equal(isJobRunning(1234, { alive: () => true, state: () => 'S' }), true);
  assert.equal(isJobRunning(1234, { alive: () => true, state: () => null }), true, 'no /proc: a live pid counts');
  assert.equal(isJobRunning(1234, { alive: () => false, state: () => 'S' }), false);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
  try {
    assert.equal(isJobRunning(child.pid), true);
  } finally {
    child.kill();
  }
  assert.equal(isJobRunning(deadPid()), false);
});

test('wait --job: arguments, the schema entry and the help name the new mode', () => {
  assert.equal(parseWaitArgs(['--job=123']).jobId, 123);
  assert.equal(parseWaitArgs(['--job', '123']).error, null, 'a space also separates the value');
  assert.match(parseWaitArgs(['--job=abc']).error, /--job=<pid>/);
  assert.match(parseWaitArgs(['--job=0']).error, /--job=<pid>/);
  assert.match(parseWaitArgs(['--job=1', '--verify-idle']).error, /exactly one of/);
  const flags = findCommandSchema('wait').flags.map((flag) => flag.flag);
  assert.ok(flags.includes('--job=<pid>'));
});

test('wait --job: waits for a running job, then reports its record and exits with its code', async () => {
  const dir = tempDir();
  try {
    writeJobRecord({ command: 'chemx test --changed', status: 'fail', exitCode: 1, summary: '2 failed' }, { dir, pid: 777 });
    let polls = 0;
    const env = { jobsDir: dir, isJobRunning: () => (++polls) < 3 };
    const result = await runWait(['--job=777', '--timeout=1m'], { pollMs: 1, sleep: async () => {}, env });
    assert.equal(polls, 3);
    assert.equal(result.code, 1, 'the job failed, so does the wait');
    assert.match(result.message, /job 777 ended: fail \(2 failed\) \[chemx test --changed\]/);
    writeJobRecord({ command: 'chemx test', status: 'pass', exitCode: 0, summary: '9 passed' }, { dir, pid: 778 });
    const passed = await runWait(['--job=778'], { pollMs: 1, sleep: async () => {}, env: { jobsDir: dir, isJobRunning: () => false } });
    assert.equal(passed.code, 0);
    const none = await runWait(['--job=779'], { pollMs: 1, sleep: async () => {}, env: { jobsDir: dir, isJobRunning: () => false } });
    assert.equal(none.code, 0);
    assert.match(none.message, /job 779 is not running \(it left no result\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wait --job: a job that keeps running times out with code 2', async () => {
  let now = 0;
  const result = await runWait(['--job=5', '--timeout=10s'], { pollMs: 1000, sleep: async () => { now += 1000; }, clock: () => now, env: { isJobRunning: () => true } });
  assert.equal(result.code, 2);
  assert.match(result.message, /job 5 is still running/);
});

test('wait --job: a real chemx test run leaves a record under its pid, and the wait reads its verdict', { timeout: 60000 }, async () => {
  const jobs = tempDir();
  const slots = tempDir();
  const files = {
    'package.json': JSON.stringify({ name: 'kit', type: 'module', scripts: { test: 'node --test cli/*.spec.js' } }),
    'cli/ok.spec.js': SPEC(),
    'cli/bad.spec.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('breaks', () => assert.equal(1, 2));\n"
  };
  try {
    await withProject(files, async (root) => {
      const env = { ...process.env, CHEMX_JOBS_DIR: jobs, CHEMX_TEST_SLOTS_DIR: slots, CHEMX_TEST_CONCURRENCY: '2', CHEMX_AGENT_ID: '@job-spec' };
      const ok = spawnSync(process.execPath, [CLI, 'test', 'cli/ok.spec.js'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      const okRecord = readJobRecord(ok.pid, { dir: jobs });
      assert.equal(okRecord.status, 'pass');
      assert.equal(okRecord.exitCode, 0);
      assert.equal(okRecord.command, 'chemx test cli/ok.spec.js');
      const bad = spawnSync(process.execPath, [CLI, 'test', 'cli/bad.spec.js'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(bad.status, 1);
      const waited = await runWait([`--job=${bad.pid}`], { pollMs: 1, sleep: async () => {}, env: { jobsDir: jobs } });
      assert.equal(waited.code, 1, 'the wait exits with the failed job\'s code');
      assert.match(waited.message, new RegExp(`job ${bad.pid} ended: fail`));
    });
  } finally {
    fs.rmSync(jobs, { recursive: true, force: true });
    fs.rmSync(slots, { recursive: true, force: true });
  }
});
