// `chemx test`: run the project's tests silently and report a tri-state verdict.
import path from 'node:path';
import { findProjectRoot } from './build/detector.js';
import { STATUS, toExitCode } from './result-status.js';
import { parseCliArgs, describeArgErrors, parseTimeoutSeconds } from './cli-args.js';
import { planTestCommand } from './test-command.js';
import { runWithinBudget } from './test-run.js';
import { parseTestOutput, REASONS } from './test-output.js';
import { formatTestReport, TEST_HELP } from './test-report.js';
import { checkNodeModules } from './verify-helpers.js';
import { formatAgentJson } from './agent-json.js';

const TEST_ARGS = {
  booleans: { '--json': 'json', '--raw': 'raw', '--allow-empty': 'allowEmpty', '--help': 'help', '-h': 'help' },
  values: { '--target': 'target', '--filter': 'filter', '-t': 'filter', '--test-name-pattern': 'filter', '--timeout': 'timeout' }
};

const emptyCounts = { totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0 };

const earlyReport = (status, command, fields) => ({
  status, success: status === STATUS.PASS, reason: null, exitCode: 1, command, durationMs: 0,
  ...emptyCounts, executionError: null, failures: [], ...fields
});

const emit = (report, { isJson, isCli, shouldPrint }) => {
  if (shouldPrint) process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : formatTestReport(report));
  if (isCli) process.exit(toExitCode(report.status));
  return report;
};

const resolveScope = (parsed, options) => {
  const explicit = options.target || parsed.values.target;
  // The router already removed the command name, so a positional `test` is a real target directory.
  const targets = explicit ? [String(explicit)] : parsed.positionals;
  return { targets, filter: options.filter || parsed.values.filter || null };
};

export const runTestAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const parsed = parseCliArgs(rawArgs, TEST_ARGS);
  const isJson = Boolean(parsed.flags.json) || options.json === true;
  const output = { isJson, isCli, shouldPrint: options.print !== false };
  if (parsed.flags.help) {
    if (output.shouldPrint) process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : TEST_HELP);
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const customCmd = parsed.command || options.command;
  const argError = describeArgErrors(parsed, 'test');
  if (argError) return emit(earlyReport(STATUS.FAIL, customCmd || 'test', { reason: 'USAGE', executionError: argError }), output);

  const cwd = findProjectRoot(options.cwd || process.cwd());
  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('testing');
    return emit(earlyReport(STATUS.FAIL, customCmd || 'test', { failed: 1, executionError: friendlyMsg, failures: [{ name: 'dependencies', details: [friendlyMsg] }] }), output);
  }

  const { targets, filter } = resolveScope(parsed, options);
  const plan = planTestCommand(customCmd, cwd, { targets, filter });
  const runDir = path.relative(cwd, plan.cwd) || '.';
  const hasMissingTargets = plan.missingTargets.length > 0;
  if (hasMissingTargets) {
    const detail = `target(s) matched nothing: ${plan.missingTargets.join(', ')}`;
    return emit(earlyReport(STATUS.INCONCLUSIVE, plan.command, { reason: REASONS.NO_TESTS_RAN, detail, runner: plan.runner, runDir }), output);
  }

  const allowEmpty = Boolean(parsed.flags.allowEmpty || options.allowEmpty);
  const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? null;
  const isRaw = Boolean(parsed.flags.raw) || options.raw === true;
  const { execution, command, workers, budget, queuedMs } = await runWithinBudget(plan, { raw: isRaw, timeoutMs, env: options.env, onWait: options.onWait });
  const result = parseTestOutput(execution.stdout, execution.stderr, execution.exitCode, { allowEmpty, scoped: targets.length > 0 || Boolean(filter), timedOut: execution.timedOut, timeoutMs });

  const report = {
    status: result.status,
    success: result.success,
    reason: result.reason,
    ...(result.detail ? { detail: result.detail } : {}),
    exitCode: execution.exitCode,
    command,
    runner: plan.runner,
    runDir,
    workers,
    budget,
    queuedMs,
    durationMs: execution.durationMs,
    totalTests: result.totalTests,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    errors: result.errors,
    executionError: result.executionError,
    failures: result.failures
  };
  return emit(report, output);
};
