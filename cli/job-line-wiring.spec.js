import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runWithinBudget } from './test-run.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { runBuildAudit } from './build.js';
import { runHeavy } from './job-line.js';
import { acquireTestSlots, SLOT_OWNER_ENV, SLOT_WAIT_TIMEOUT_CODE } from './test-slots.js';
import { STATUS } from './result-status.js';
import { FAST, options, named, heldRun, delay } from './job-line-spec-helpers.js';
import { withProject, lineEnv, probeCommand, probed, logLines, planOf } from './job-line-wiring-helpers.js';

const QUIET = { ...FAST, onWait: () => {}, onWarn: () => {} };

test('wiring: a test run that names targets takes light slots and never a ticket', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, probeCommand(log, slots), { targets: ['a.spec.js'] });
  const outcome = await runWithinBudget(plan, { env: lineEnv(slots), ...QUIET });
  assert.equal(outcome.execution.exitCode, 0, outcome.execution.stderr);
  const [seen] = probed(log);
  assert.deepEqual(seen.names.filter((name) => name.startsWith('ticket-')), []);
  assert.ok(seen.names.some((name) => name.startsWith('slot-')), 'it held light slots while it ran');
  assert.equal(outcome.shared, null);
}));

test('wiring: a test run with no targets takes a tests ticket and the runner gets the heavy worker count', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, probeCommand(log, slots));
  const outcome = await runWithinBudget(plan, { env: lineEnv(slots), ...QUIET });
  assert.equal(outcome.execution.exitCode, 0, outcome.execution.stderr);
  const [seen] = probed(log);
  assert.deepEqual(seen.kinds, { 'ticket-1': 'tests' });
  assert.deepEqual(seen.rest, ['--maxWorkers=4'], 'budget 6 minus the reserve of 2');
  assert.deepEqual([outcome.workers, outcome.budget], [4, 6]);
  assert.match(outcome.command, /--maxWorkers=4$/);
  assert.equal(outcome.shared, null);
  assert.deepEqual(fs.readdirSync(slots).filter((name) => /^(ticket|slot|join|result)-/.test(name)), [], 'the line is empty again');
}));

test('wiring: a script that caps its own test concurrency keeps the cap below the heavy workers', withProject(async ({ slots, work }) => {
  const plan = planOf(work, 'node --test --test-concurrency=2 empty.cjs', { runner: 'node' });
  const outcome = await runWithinBudget(plan, { env: lineEnv(slots), ...QUIET });
  assert.equal(outcome.execution.exitCode, 0, outcome.execution.stderr);
  assert.match(outcome.command, /--test-concurrency=2/);
  assert.equal(outcome.workers, 4, 'the line still granted the heavy slots');
}));

test('wiring: a full test run inside a heavy run (SLOT_OWNER_ENV) runs at once on one worker', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, probeCommand(log, slots));
  const outcome = await runWithinBudget(plan, { env: lineEnv(slots, { [SLOT_OWNER_ENV]: '1' }), ...QUIET });
  assert.deepEqual(probed(log)[0].kinds, {}, 'no ticket');
  assert.equal(outcome.workers, 1);
  assert.deepEqual(probed(log)[0].rest, ['--maxWorkers=1']);
}));

test('wiring: callers asking for the same full suite share one run; the joiner names the owner', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, `node count.cjs ${log}`);
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'build', key: 'k:blocker', ...options(slots) }, blocker.run);
  await blocker.started;
  const first = runWithinBudget(plan, { env: lineEnv(slots, { CHEMX_AGENT_ID: '@first' }), ...QUIET });
  const second = runWithinBudget(plan, { env: lineEnv(slots, { CHEMX_AGENT_ID: '@second' }), ...QUIET });
  assert.equal(named(slots, 'join-').length, 1, 'the second caller joined the first one\'s ticket');
  blocker.finish();
  const [a, b] = await Promise.all([first, second]);
  await ahead;
  assert.equal(logLines(log).length, 1, 'the command ran once');
  assert.deepEqual(b.execution, a.execution);
  assert.equal(b.execution.stdout, 'counted\n');
  assert.deepEqual(b.shared, { owner: '@first', joined: 1, seq: 2 });
  assert.deepEqual(a.shared, { owner: '@first', joined: 1, seq: 2 });
  assert.equal(b.command, a.command);
}));

test('wiring: a full test run that waits past --wait-timeout gives up with the queue timeout code', withProject(async ({ slots, work, log }) => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'build', key: 'k:blocker', ...options(slots, { handle: '@holder' }) }, blocker.run);
  await blocker.started;
  const plan = planOf(work, `node count.cjs ${log}`);
  const gaveUp = await runWithinBudget(plan, { env: lineEnv(slots), waitTimeoutMs: 60, ...QUIET }).catch((error) => error);
  assert.equal(gaveUp.code, SLOT_WAIT_TIMEOUT_CODE);
  assert.match(gaveUp.message, /^chemx: queued too long \(\d+s\), held by @holder$/, 'the four heavy slots of one job name it once');
  assert.deepEqual(named(slots, 'ticket-'), ['ticket-1'], 'its ticket is gone');
  assert.deepEqual(logLines(log), [], 'nothing ran');
  blocker.finish();
  await ahead;
}));

test('wiring: a light run holding the reserve leaves the heavy slots free: a full test run starts at once', withProject(async ({ slots, work, log }) => {
  const light = await acquireTestSlots({ dir: slots, env: lineEnv(slots, { CHEMX_AGENT_ID: '@light' }), want: 2, heartbeatMs: FAST.heartbeatMs });
  assert.deepEqual(named(slots, 'slot-'), ['slot-4', 'slot-5'], 'the light run took the reserve');
  const outcome = await runWithinBudget(planOf(work, probeCommand(log, slots)), { env: lineEnv(slots), returnQueuedAfterMs: 20, ...QUIET });
  assert.equal(outcome.queued, undefined, 'it did not wait for the light run');
  assert.equal(outcome.execution.exitCode, 0, outcome.execution.stderr);
  assert.deepEqual(probed(log)[0].kinds, { 'ticket-1': 'tests' });
  assert.equal(outcome.workers, 4);
  light.release();
}));

test('wiring: a queued full test run reports who holds the slots and keeps no ticket', withProject(async ({ slots, work, log }) => {
  // Three light slots: the reserve (4, 5) and heavy slot 0, which the full run has to wait for.
  const light = await acquireTestSlots({ dir: slots, env: lineEnv(slots, { CHEMX_AGENT_ID: '@light' }), want: 3, heartbeatMs: FAST.heartbeatMs });
  const plan = planOf(work, `node count.cjs ${log}`);
  const outcome = await runWithinBudget(plan, { env: lineEnv(slots), returnQueuedAfterMs: 20, retryCommand: 'chemx test --json', ...QUIET });
  assert.equal(outcome.queued, true);
  assert.equal(outcome.retryCommand, 'chemx test --json');
  assert.equal(outcome.holders[0].handle, '@light');
  assert.deepEqual(named(slots, 'ticket-'), []);
  assert.deepEqual(logLines(log), []);
  light.release();
}));

test('wiring: a queued full test run behind a running job names it once, with the tickets ahead', withProject(async ({ slots, work, log }) => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'build', key: 'k:blocker', ...options(slots, { handle: '@builder' }) }, blocker.run);
  await blocker.started;
  const outcome = await runWithinBudget(planOf(work, `node count.cjs ${log}`), { env: lineEnv(slots), returnQueuedAfterMs: 20, ...QUIET });
  assert.equal(outcome.queued, true);
  assert.deepEqual(outcome.holders.map((holder) => holder.handle), ['@builder'], 'one row for the four heavy slots of one job');
  assert.deepEqual(outcome.ahead.map((entry) => entry.kind), ['build']);
  blocker.finish();
  await ahead;
}));

test('wiring: the typecheck runner takes a typecheck ticket around its command', withProject(async ({ slots, work, log }) => {
  const report = await runTypecheckAudit(['--json'], false, { cwd: work, print: false, command: probeCommand(log, slots), env: lineEnv(slots), ...QUIET });
  assert.equal(report.status, STATUS.PASS, report.executionError);
  assert.deepEqual(probed(log)[0].kinds, { 'ticket-1': 'typecheck' });
  assert.equal(report.sharedRun, undefined);
  assert.deepEqual(named(slots, 'ticket-'), []);
}));

test('wiring: the build runner takes a build ticket around its command', withProject(async ({ slots, work, log }) => {
  const report = await runBuildAudit(['--json'], false, { cwd: work, print: false, command: probeCommand(log, slots), env: lineEnv(slots), ...QUIET });
  assert.equal(report.status, STATUS.PASS, report.executionError);
  assert.deepEqual(probed(log)[0].kinds, { 'ticket-1': 'build' });
  assert.equal(report.sharedRun, undefined);
  assert.deepEqual(named(slots, 'ticket-'), []);
}));

// A real node spawn on a loaded machine can take a good part of a second to start, so the build's
// own --timeout is counted in seconds; the wait outlasts it, which is what the spec shows.
const BUILD_TIMEOUT_MS = 3000;
const WAIT_IN_LINE_MS = 3500;

test('wiring: a build waits in the line without spending its --timeout on the wait', withProject(async ({ slots, work, log }) => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'tests', key: 'k:blocker', ...options(slots) }, blocker.run);
  await blocker.started;
  const building = runBuildAudit(['--json'], false, { cwd: work, print: false, command: probeCommand(log, slots), timeoutMs: BUILD_TIMEOUT_MS, env: lineEnv(slots), ...QUIET });
  await delay(WAIT_IN_LINE_MS);
  assert.deepEqual(logLines(log), [], 'it waits for the running job');
  blocker.finish();
  const report = await building;
  assert.equal(report.status, STATUS.PASS, `the ${BUILD_TIMEOUT_MS}ms timeout counted only the run, not the ${WAIT_IN_LINE_MS}ms wait`);
  await ahead;
}));
