import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChemxTypecheck, handleAuditBuild } from './mcp/tools-verify.js';
import { runHeavy } from './job-line.js';
import { SLOT_OWNER_ENV } from './test-slots.js';
import { STATUS } from './result-status.js';
import { options, named, heldRun } from './job-line-spec-helpers.js';
import { withProject, probeCommand, logLines } from './job-line-wiring-helpers.js';

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

// A heavy job of another key holds the line; `call` is the MCP handler under test.
const queuedBehindARunningJob = (slots, call) => inLineEnv(slots, async () => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'tests', key: 'k:blocker', ...options(slots, { handle: '@builder' }) }, blocker.run);
  await blocker.started;
  const started = Date.now();
  const report = await call();
  const waitedMs = Date.now() - started;
  assert.ok(waitedMs < 2500, `answered in ${waitedMs}ms, not after the running job`);
  assert.deepEqual(named(slots, 'ticket-'), ['ticket-1'], 'the queued call left no ticket of its own');
  blocker.finish();
  await ahead;
  return report;
});

const assertQueued = (report, noun, retryPattern) => {
  assert.equal(report.queued, true);
  assert.equal(report.status, STATUS.INCONCLUSIVE);
  assert.equal(report.reason, 'QUEUED');
  assert.equal(report.exitCode, 0);
  assert.equal(report.position, 2);
  assert.deepEqual(report.ahead.map((entry) => entry.kind), ['tests']);
  assert.deepEqual(report.holders.map((holder) => holder.handle), ['@builder']);
  assert.match(report.retryCommand, retryPattern);
  assert.match(report.detail, new RegExp(`no ${noun} ran and no slot is held`));
};

test('wiring mcp: chemx_typecheck answers queued within ~2s behind a running heavy job', withProject(async ({ slots, work, log }) => {
  const report = await queuedBehindARunningJob(slots, () => handleChemxTypecheck({ dir: work, command: probeCommand(log, slots) }, work));
  assertQueued(report, 'typecheck', /^chemx typecheck -- node probe\.cjs/);
  assert.deepEqual(logLines(log), [], 'the checker did not run');
}));

test('wiring mcp: chemx_build answers queued within ~2s behind a running heavy job', withProject(async ({ slots, work, log }) => {
  const report = await queuedBehindARunningJob(slots, () => handleAuditBuild({ dir: work, command: probeCommand(log, slots), timeout: 30 }, work));
  assertQueued(report, 'build', /^chemx build --timeout=30 -- node probe\.cjs/);
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
