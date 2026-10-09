// `chemx typecheck`: run the project's type checker silently and report a tri-state verdict.
import { executeBuild } from './build/executor.js';
import { findProjectRoot } from './build/detector.js';
import { ANSI } from './theme.js';
import { STATUS, toExitCode, isPass, isInconclusive } from './result-status.js';
import { parseCliArgs, describeArgErrors, parseTimeoutSeconds } from './cli-args.js';
import { planTypecheck } from './typecheck-command.js';
import { parseTypecheckOutput, checkNodeModules } from './verify-helpers.js';

const TYPECHECK_ARGS = {
  booleans: { '--json': 'json', '--raw': 'raw', '--help': 'help', '-h': 'help' },
  values: { '--timeout': 'timeout' }
};

const TYPECHECK_HELP = [
  `${ANSI.BOLD}USAGE${ANSI.RESET}`,
  '  chemx typecheck [options] [-- <command>]',
  '',
  '  Uses the "typecheck" script when present, else the local vue-tsc / svelte-check / tsc.',
  '  A missing checker is reported as inconclusive (exit 3), never as clean.',
  '',
  `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
  '  --timeout=<seconds>      Stop the check after this long (result: inconclusive)',
  '  --json                   Output structured diagnostics as JSON',
  '  --raw                    Stream the checker output as it runs',
  '  -h, --help               Show this help message',
  ''
].join('\n');

const formatTypecheckReport = (report) => {
  if (isPass(report.status)) {
    return `  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}TypeScript typecheck clean${ANSI.RESET} ${ANSI.DIM}(${report.durationMs}ms, ${report.command})${ANSI.RESET}\n`;
  }
  if (isInconclusive(report.status)) {
    return `  ${ANSI.YELLOW}?${ANSI.RESET} ${ANSI.BOLD}Typecheck inconclusive: ${report.reason}${ANSI.RESET} ${ANSI.DIM}(${report.executionError})${ANSI.RESET}\n`;
  }
  const hasNoDiagnostics = report.errors.length === 0;
  if (hasNoDiagnostics) {
    return `\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Execution Error:${ANSI.RESET} ${report.executionError}\n\n`;
  }
  const out = [`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Errors (${report.errorCount} found)${ANSI.RESET}`];
  for (const err of report.errors.slice(0, 10)) out.push(`    ${ANSI.CYAN}${err.file}:${err.line}:${err.column}${ANSI.RESET} [${err.code}] ${err.message}`);
  const hasMore = report.errors.length > 10;
  if (hasMore) out.push(`    ${ANSI.DIM}...and ${report.errors.length - 10} more diagnostics${ANSI.RESET}`);
  return `${out.join('\n')}\n\n`;
};

const emit = (report, { isJson, isCli, shouldPrint }) => {
  if (shouldPrint) process.stdout.write(isJson ? `${JSON.stringify(report, null, 2)}\n` : formatTypecheckReport(report));
  if (isCli) process.exit(toExitCode(report.status));
  return report;
};

const earlyReport = (status, command, fields) => ({
  status, success: status === STATUS.PASS, reason: null, exitCode: 1, command, durationMs: 0, errorCount: 0, executionError: null, errors: [], ...fields
});

const firstErrorLine = (execution) => {
  const rawLines = `${execution.stderr}\n${execution.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return rawLines.find((l) => /error|not found|cannot find/i.test(l)) || rawLines[0] || `Command exited with code ${execution.exitCode}`;
};

const typecheckStatusOf = (execution, errors) => {
  if (execution.timedOut) return STATUS.INCONCLUSIVE;
  const isClean = execution.exitCode === 0 && errors.length === 0;
  return isClean ? STATUS.PASS : STATUS.FAIL;
};

const describeExecutionError = (execution, hasBareFailure, timeoutMs) => {
  if (execution.timedOut) return `Timed out after ${timeoutMs}ms`;
  return hasBareFailure ? firstErrorLine(execution) : null;
};

export const runTypecheckAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const parsed = parseCliArgs(rawArgs, TYPECHECK_ARGS);
  const isJson = Boolean(parsed.flags.json) || options.json === true;
  const output = { isJson, isCli, shouldPrint: options.print !== false };
  if (parsed.flags.help) {
    if (output.shouldPrint) process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : TYPECHECK_HELP);
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const customCmd = parsed.command || options.command;
  const argError = describeArgErrors(parsed, 'typecheck');
  if (argError) return emit(earlyReport(STATUS.FAIL, customCmd || 'typecheck', { reason: 'USAGE', executionError: argError }), output);

  const cwd = findProjectRoot(options.cwd || process.cwd());
  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('typechecking');
    const missingDeps = { file: 'package.json', line: 1, column: 1, code: 'MISSING_NODE_MODULES', message: friendlyMsg };
    return emit(earlyReport(STATUS.FAIL, customCmd || 'typecheck', { errorCount: 1, executionError: friendlyMsg, errors: [missingDeps] }), output);
  }

  const plan = planTypecheck(customCmd, cwd);
  const cannotRun = !plan.command;
  if (cannotRun) return emit(earlyReport(plan.status, plan.checker || 'typecheck', { reason: plan.reason, executionError: plan.message }), output);

  const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? null;
  const isRaw = Boolean(parsed.flags.raw) || options.raw === true;
  const execution = await executeBuild(plan.command, cwd, { raw: isRaw, timeoutMs });
  const errors = parseTypecheckOutput(execution.stdout, execution.stderr);
  const status = typecheckStatusOf(execution, errors);
  const hasBareFailure = status === STATUS.FAIL && errors.length === 0;

  const report = {
    status,
    success: status === STATUS.PASS,
    reason: execution.timedOut ? 'STEP_TIMEOUT' : null,
    exitCode: execution.exitCode,
    command: plan.command,
    checker: plan.checker,
    durationMs: execution.durationMs,
    errorCount: errors.length,
    executionError: describeExecutionError(execution, hasBareFailure, timeoutMs),
    errors
  };
  return emit(report, output);
};
