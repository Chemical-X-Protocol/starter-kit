// The waiting notice (task #6772): once, with the job id, then only on a change, always on stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeNotice, jobHint } from './wait-notice.js';
import { acquireTestSlots } from './test-slots.js';
import { scheduleTimeout } from './timers.js';

const wait = (ms) => new Promise((resolve) => scheduleTimeout(resolve, ms));
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-notice-'));

test('wait notice: the first line carries the job id, a repeat of the same situation is silent', () => {
  const said = [];
  const notice = makeNotice(100, (line) => said.push(line));
  assert.equal(notice('a', () => 'waiting 0s\n', 0), true);
  assert.equal(said[0], `waiting 0s ${jobHint()}\n`);
  assert.match(jobHint(), new RegExp(`^\\[job ${process.pid}: chemx wait --job=${process.pid}\\]$`));
  assert.equal(notice('a', () => assert.fail('the line is not built when nothing is due'), 10 ** 6), false, 'an hour later, still the same');
  assert.equal(said.length, 1);
});

test('wait notice: a change is said once, without the hint, and not more often than statusMs', () => {
  const said = [];
  const notice = makeNotice(100, (line) => said.push(line));
  notice('a', () => 'one\n', 0);
  assert.equal(notice('b', () => 'two\n', 50), false, 'changed but inside the status window');
  assert.equal(notice('b', () => 'two\n', 150), true, 'the change is said once the window is over');
  assert.equal(said[1], 'two\n', 'no job hint on a later line');
  assert.equal(notice('b', () => 'two\n', 400), false);
  assert.equal(notice('a', () => 'one again\n', 400), true, 'a change back is a change');
});

test('wait notice: a queued light run says it once however long it waits, and names the job', async () => {
  const dir = tempDir();
  const lines = [];
  try {
    const first = await acquireTestSlots({ dir, budget: 1, want: 1, env: {} });
    const second = acquireTestSlots({ dir, budget: 1, want: 1, env: {}, pollMs: 5, statusMs: 20, heartbeatMs: 30, onWait: (line) => lines.push(line) });
    await wait(250);
    assert.equal(lines.length, 1, 'twelve status periods, one line');
    assert.match(lines[0], /waiting for a test slot/);
    assert.match(lines[0], new RegExp(`chemx wait --job=${process.pid}\\]\\n$`));
    first.release();
    (await second).release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wait notice: with no onWait the line goes to stderr, a terminal or not', async () => {
  const dir = tempDir();
  const written = [];
  const write = process.stderr.write;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  try {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    const first = await acquireTestSlots({ dir, budget: 1, want: 1, env: {} });
    process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
    const second = acquireTestSlots({ dir, budget: 1, want: 1, env: {}, pollMs: 5 });
    await wait(60);
    process.stderr.write = write;
    first.release();
    (await second).release();
    assert.equal(written.length, 1);
    assert.match(written[0], /^chemx test: waiting for a test slot/);
  } finally {
    process.stderr.write = write;
    if (ttyDescriptor) Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
    else delete process.stderr.isTTY;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
