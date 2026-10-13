import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithinBudget } from './test-run.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { runBuildAudit } from './build.js';
import { runHeavy } from './job-line.js';
import { formatTestReport, TEST_HELP } from './test-report.js';
import { formatTerminalBuildReport } from './build/reporter.js';
import { typecheckSection, testsSection, buildSection } from './verify-steps.js';
import { formatAgentJson } from './agent-json.js';
import { stripAnsi } from './terminal.js';
import { STATUS } from './result-status.js';
import { FAST, options, named, heldRun, until } from './job-line-spec-helpers.js';
import { withProject, lineEnv, planOf, logLines, captureStdout } from './job-line-wiring-helpers.js';

const QUIET = { ...FAST, onWait: () => {}, onWarn: () => {} };
const SHARED_LINE = 'chemx: shared run (owner @first, 1 joined)';
const SHARED = { owner: '@first', joined: 1, seq: 2 };

// Two callers asking for the same thing behind a running job: the first takes the ticket, the second joins it.
const sharedPair = async (slots, call) => {
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'tests', key: 'k:blocker', ...options(slots) }, blocker.run);
  await blocker.started;
  const first = call(lineEnv(slots, { CHEMX_AGENT_ID: '@first' }));
  const second = call(lineEnv(slots, { CHEMX_AGENT_ID: '@second' }));
  assert.equal(named(slots, 'join-').length, 1, 'the second caller joined');
  blocker.finish();
  const results = await Promise.all([first, second]);
  await ahead;
  return results;
};

test('wiring output: a shared typecheck sets sharedRun in the JSON for both callers', withProject(async ({ slots, work, log }) => {
  const call = (env) => runTypecheckAudit(['--json'], false, { cwd: work, print: false, command: `node count.cjs ${log}`, env, ...QUIET });
  const reports = await sharedPair(slots, call);
  assert.equal(logLines(log).length, 1, 'the checker ran once');
  for (const report of reports) {
    assert.equal(report.status, STATUS.PASS);
    assert.deepEqual(report.sharedRun, SHARED);
    assert.deepEqual(JSON.parse(formatAgentJson(report)).sharedRun, SHARED);
  }
}));

test('wiring output: a shared typecheck prints the shared-run line once per caller', withProject(async ({ slots, work, log }) => {
  const call = (env) => runTypecheckAudit([], false, { cwd: work, print: true, command: `node count.cjs ${log}`, env, ...QUIET });
  const text = stripAnsi(await captureStdout(() => sharedPair(slots, call)));
  assert.equal(text.split(SHARED_LINE).length - 1, 2, 'one line for each of the two callers');
  assert.equal(text.split('TypeScript typecheck clean').length - 1, 2);
}));

test('wiring output: a shared build sets sharedRun in the JSON and prints the line in the terminal report', withProject(async ({ slots, work, log }) => {
  const call = (env) => runBuildAudit(['--json'], false, { cwd: work, print: false, command: `node count.cjs ${log}`, env, ...QUIET });
  const reports = await sharedPair(slots, call);
  assert.equal(logLines(log).length, 1, 'the build ran once');
  for (const report of reports) assert.deepEqual(report.sharedRun, SHARED);
  const terminal = stripAnsi(formatTerminalBuildReport(reports[1], {}));
  assert.equal(terminal.split(SHARED_LINE).length - 1, 1);
  assert.equal(formatTerminalBuildReport({ ...reports[1], sharedRun: undefined }, {}).includes('shared run'), false);
  assert.equal(formatTerminalBuildReport(reports[1], { silent: true }), '', 'a silent success stays silent');
}));

test('wiring output: a shared test run carries sharedRun and its report prints the line once', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, `node count.cjs ${log}`);
  const [owner, joiner] = await sharedPair(slots, (env) => runWithinBudget(plan, { env, ...QUIET }));
  assert.deepEqual([owner.shared, joiner.shared], [SHARED, SHARED]);
  const report = { status: STATUS.PASS, passed: 3, skipped: 0, todo: 0, durationMs: 5, command: owner.command, sharedRun: joiner.shared };
  const text = stripAnsi(formatTestReport(report));
  assert.equal(text.split(SHARED_LINE).length - 1, 1);
  assert.equal(stripAnsi(formatTestReport({ ...report, sharedRun: undefined })).includes('shared run'), false);
}));

test('wiring output: a raw joiner prints the stored output once the owner\'s result lands', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, `node count.cjs ${log}`);
  const text = await captureStdout(() => sharedPair(slots, (env) => runWithinBudget(plan, { env, raw: true, ...QUIET })));
  assert.equal(text.split('counted').length - 1, 2, 'the owner streamed it, the joiner replayed it');
}));

test('wiring output: a joiner that is not raw prints nothing of the stored output', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, `node count.cjs ${log}`);
  const text = await captureStdout(() => sharedPair(slots, (env) => runWithinBudget(plan, { env, ...QUIET })));
  assert.equal(text, '');
}));

test('wiring output: an owner cancelled mid-run is not shared: its joiner takes the ticket over and runs it', withProject(async ({ slots, work, log }) => {
  const plan = planOf(work, `node hang-first.cjs ${log}`);
  const controller = new AbortController();
  const blocker = heldRun('blocker');
  const ahead = runHeavy({ kind: 'tests', key: 'k:blocker', ...options(slots) }, blocker.run);
  await blocker.started;
  const first = runWithinBudget(plan, { env: lineEnv(slots, { CHEMX_AGENT_ID: '@first' }), signal: controller.signal, ...QUIET });
  const second = runWithinBudget(plan, { env: lineEnv(slots, { CHEMX_AGENT_ID: '@second' }), ...QUIET });
  blocker.finish();
  await until(() => logLines(log).length === 1, 'the first run to start');
  controller.abort();
  const [cancelled, retaken] = await Promise.all([first, second]);
  await ahead;
  assert.equal(cancelled.execution.cancelled, true);
  assert.equal(cancelled.shared, null, 'a cancelled run is nobody\'s result');
  assert.equal(retaken.execution.exitCode, 0);
  assert.equal(retaken.execution.stdout, 'second run\n');
  assert.equal(retaken.shared, null, 'it ran alone');
  assert.equal(logLines(log).length, 2);
}));

test('wiring output: verify sections carry sharedRun only for a shared step', () => {
  const sharedRun = { owner: '@a', joined: 2, seq: 7 };
  const typecheck = { status: STATUS.PASS, success: true, command: 'tsc', errorCount: 0, errors: [] };
  const tests = { status: STATUS.PASS, success: true, command: 'npm test', totalTests: 1, passed: 1, failed: 0, skipped: 0, errors: 0, failures: [] };
  const build = { status: STATUS.PASS, command: 'npm run build', exitCode: 0, durationMs: 1, counts: { total: 0, errors: 0 }, rawTail: [] };
  for (const [section, report] of [[typecheckSection, typecheck], [testsSection, tests], [buildSection, build]]) {
    assert.deepEqual(section({ ...report, sharedRun }).sharedRun, sharedRun);
    assert.equal('sharedRun' in section(report), false);
  }
});

test('wiring output: the test help describes the line, its lanes and the light reserve', () => {
  const help = stripAnsi(TEST_HELP);
  assert.match(help, /THE LINE/);
  assert.match(help, /CHEMX_LIGHT_RESERVE/);
  assert.match(help, /named targets/);
  assert.match(help, /shared run/);
});
