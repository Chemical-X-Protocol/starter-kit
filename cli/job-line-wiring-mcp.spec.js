import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleChemxTypecheck, handleAuditBuild, handleChemxTest } from './mcp/tools-verify.js';
import { runHeavy } from './job-line.js';
import { acquireTestSlots, SLOT_OWNER_ENV } from './test-slots.js';
import { STATUS } from './result-status.js';
import { FAST, options, named, heldRun } from './job-line-spec-helpers.js';
import { withProject, lineEnv, probeCommand, logLines, captureStderr } from './job-line-wiring-helpers.js';

// The MCP handlers read the slot dir and budget from process.env, so these specs set it for their run.
const inLineEnv = async (slots, body) => {
  const keys = ['CHEMX_TEST_SLOTS_DIR', 'CHEMX_TEST_CONCURRENCY', 'CHEMX_LIGHT_RESERVE', SLOT_OWNER_ENV];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { CHEMX_TEST_SLOTS_DIR: slots, CHEMX_TEST_CONCURRENCY: '6', CHEMX_LIGHT_RESERVE: '2' });
  delete process.env[SLOT_OWNER_ENV];
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      const wasSet = value !== undefined;
      if (wasSet) process.env[key] = value;
      else delete process.env[key];
    }
  }
};

// The MCP call returns after MCP_QUEUE_RETURN_MS (1.5 s). The bound below is far wider so a loaded
// machine does not flake it, yet still shows the call did not wait for the running job to end.
const ANSWERED_WITHIN_MS = 5000;

// A heavy job of another key holds the line; `call` is the MCP handler under test. The wait line the
// queued call prints goes to stderr (stdout is the MCP channel), so it is captured here, not leaked.
const queuedBehindARunningJob = (slots, call) => inLineEnv(slots, async () => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'tests', key: 'k:blocker', ...options(slots, { handle: '@builder' }) }, blocker.run);
  await blocker.started;
  const started = Date.now();
  let report;
  const printed = await captureStderr(async () => { report = await call(); });
  const waitedMs = Date.now() - started;
  assert.ok(waitedMs < ANSWERED_WITHIN_MS, `answered in ${waitedMs}ms, not after the running job`);
  assert.match(printed, /^chemx: in line #2 for \w+ \(budget 6, heavy 4\): running tests for @builder/, 'the wait line went to stderr');
  assert.deepEqual(named(slots, 'ticket-'), ['ticket-1'], 'the queued call left no ticket of its own');
  blocker.finish();
  await ahead;
  return report;
});

const assertQueued = (report, noun, retryCommand) => {
  assert.equal(report.queued, true);
  assert.equal(report.status, STATUS.INCONCLUSIVE);
  assert.equal(report.reason, 'QUEUED');
  assert.equal(report.exitCode, 0);
  assert.equal(report.position, 2);
  assert.deepEqual(report.ahead.map((entry) => entry.kind), ['tests']);
  assert.deepEqual(report.holders.map((holder) => holder.handle), ['@builder']);
  assert.equal(report.retryCommand, retryCommand, 'the retry runs the same call from the dir it named');
  assert.match(report.detail, new RegExp(`no ${noun} ran and no slot is held`));
};

test('wiring mcp: chemx_typecheck answers queued without waiting for a running heavy job', withProject(async ({ slots, work, log }) => {
  const report = await queuedBehindARunningJob(slots, () => handleChemxTypecheck({ dir: work, command: probeCommand(log, slots) }, work));
  assertQueued(report, 'typecheck', `cd ${work} && chemx typecheck -- ${probeCommand(log, slots)}`);
  assert.deepEqual(logLines(log), [], 'the checker did not run');
}));

test('wiring mcp: chemx_build answers queued without waiting for a running heavy job', withProject(async ({ slots, work, log }) => {
  const report = await queuedBehindARunningJob(slots, () => handleAuditBuild({ dir: work, command: probeCommand(log, slots), timeout: 30 }, work));
  assertQueued(report, 'build', `cd ${work} && chemx build --timeout=30 -- ${probeCommand(log, slots)}`);
  assert.deepEqual(logLines(log), [], 'the build did not run');
}));

test('wiring mcp: with the line free, the MCP typecheck and build run as before', withProject(async ({ slots, work, log }) => {
  await inLineEnv(slots, async () => {
    const typecheck = await handleChemxTypecheck({ dir: work, command: probeCommand(log, slots) }, work);
    const build = await handleAuditBuild({ dir: work, command: probeCommand(log, slots) }, work);
    assert.equal(typecheck.status, STATUS.PASS, typecheck.executionError);
    assert.equal(build.status, STATUS.PASS, build.executionError);
    assert.equal(typecheck.queued, undefined);
    assert.equal(build.queued, undefined);
    assert.equal(logLines(log).length, 2);
  });
}));

test('wiring mcp: a queued chemx_test retry runs from its dir with its target and filter', withProject(async ({ slots, work }) => {
  fs.mkdirSync(path.join(work, 'spec'));
  fs.writeFileSync(path.join(work, 'spec/a.spec.js'), '');
  const report = await inLineEnv(slots, async () => {
    const everySlot = await acquireTestSlots({ dir: slots, env: lineEnv(slots, { CHEMX_AGENT_ID: '@light' }), want: 6, heartbeatMs: FAST.heartbeatMs });
    try {
      let queued;
      await captureStderr(async () => { queued = await handleChemxTest({ dir: work, testTarget: 'spec/a.spec.js', filter: "it's two words" }, work); });
      return queued;
    } finally {
      everySlot.release();
    }
  });
  assert.equal(report.queued, true);
  assert.equal(report.retryCommand, `cd ${work} && chemx test spec/a.spec.js --filter='it'\\''s two words'`);
}));
