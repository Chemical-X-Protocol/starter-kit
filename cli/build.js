import { detectProjectBuildCommand, findProjectRoot } from './build/detector.js';
import { executeBuild } from './build/executor.js';
import { parseBuildOutput } from './build/parser.js';
import { groupBuildDiagnostics } from './build/grouper.js';
import { formatTerminalBuildReport, formatJsonBuildReport } from './build/reporter.js';
import { ANSI } from './theme.js';
import { handleError } from './errors/index.js';
import { STATUS, toExitCode } from './result-status.js';
import { parseCliArgs, describeArgErrors, parseTimeoutSeconds, joinCommandWords } from './cli-args.js';
import { formatAgentJson } from './agent-json.js';
import { runInLine, lineOptionsOf } from './job-line-run.js';
import { sharedRunField, queuedFields } from './job-line-text.js';

export const BUILD_ARGS = {
  booleans: {
    '--json': 'json', '--silent': 'silent', '--raw': 'raw', '--summary': 'summary',
    '--prep-issue': 'prepIssue', '--post-issue': 'postIssue', '--help': 'help', '-h': 'help'
  },
  values: { '--command': 'command', '--timeout': 'timeout' },
  positionalCommand: true
};

const BUILD_HELP = [
  'USAGE',
  '  chemx build [options] [-- <command>]',
  '  chemx run|wrap [options] <command> [args...]',
  '',
  '  Options go before the command: every word from the first command word on is passed to it.',
  '',
  'OPTIONS',
  '  --command="<cmd>"        Explicit build command (same as -- <cmd>; default: the build script)',
  '  --timeout=<seconds>      Stop the build after this long (result: inconclusive)',
  '  --json                   Output categorised diagnostics as JSON',
  '  --silent, --summary      Quieter terminal output',
  '  --raw                    Stream the build output as it runs',
  '  --prep-issue, --post-issue  Prepare or post an issue report for a failed build',
  '',
  'THE LINE',
  '  A build is heavy work: it waits its turn in the line the full test run and the typecheck share',
  '  (chemx test --help), and a caller asking for the same build while it waits shares its run.',
  ''
].join('\n');

// `-- <cmd>` wins, then --command, then a bare positional command such as `chemx build "vite build"`.
// The router already removed `build` / `run` / `wrap`, so every positional word is the user's,
// and parseCliArgs stopped reading chemx flags at the first of them.
export const resolveBuildCommand = (parsed) => {
  const positionalCommand = joinCommandWords(parsed.positionals);
  return parsed.command || parsed.values.command || positionalCommand || null;
};

// A build that gave up queueing: nothing ran, nothing is held. Inconclusive, never a pass.
const queuedBuildReport = (command, line) => ({
  status: STATUS.INCONCLUSIVE, success: false, command, counts: { total: 0, errors: 0, warnings: 0, files: 0 }, diagnostics: [], rawTail: [], ...queuedFields(line, 'build')
});

const buildStatusOf = (execution) => {
  const isTimedOut = Boolean(execution.timedOut);
  if (isTimedOut) return STATUS.INCONCLUSIVE;
  return execution.exitCode === 0 ? STATUS.PASS : STATUS.FAIL;
};

export const runBuildAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const parsed = parseCliArgs(rawArgs, BUILD_ARGS);
  const isJson = Boolean(parsed.flags.json) || options.json === true;
  const isSilent = Boolean(parsed.flags.silent) || options.silent === true;
  const isRaw = Boolean(parsed.flags.raw) || options.raw === true;
  const isSummary = Boolean(parsed.flags.summary) || options.summary === true;
  const shouldPrint = options.print !== false;
  const isHelpRequested = Boolean(parsed.flags.help);
  if (isHelpRequested) {
    if (shouldPrint) process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : BUILD_HELP);
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const argError = describeArgErrors(parsed, 'build');
  if (argError) {
    const report = { status: STATUS.FAIL, success: false, exitCode: 1, command: null, executionError: argError, counts: { total: 0, errors: 0, warnings: 0, files: 0 }, diagnostics: [], rawTail: [] };
    if (shouldPrint) process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : `${argError}\n`);
    if (isCli) process.exit(1);
    return report;
  }

  const cwd = findProjectRoot(options.cwd || process.cwd());
  const customCommand = resolveBuildCommand(parsed) || options.command;
  const command = detectProjectBuildCommand(customCommand, cwd);
  const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? null;

  const shouldPrintStart = shouldPrint && !isJson && !isSilent && !isRaw;
  if (shouldPrintStart) {
    process.stdout.write(`${ANSI.CYAN}Auditing build:${ANSI.RESET} ${ANSI.DIM}${command}${ANSI.RESET}\n`);
  }

  const lineRequest = { kind: 'build', cwd, keyCommand: command, raw: isRaw, returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand, ...lineOptionsOf(options) };
  const line = await runInLine(lineRequest, () => executeBuild(command, cwd, { raw: isRaw, timeoutMs }));
  const isQueued = line.queued === true;
  if (isQueued) {
    const queued = queuedBuildReport(command, line);
    if (shouldPrint) process.stdout.write(isJson ? `${formatJsonBuildReport(queued)}\n` : `${queued.detail}\n`);
    if (isCli) process.exit(toExitCode(queued.status));
    return queued;
  }
  const executionResult = line.execution;
  const rawDiagnostics = parseBuildOutput(executionResult.stdout, executionResult.stderr);
  const status = buildStatusOf(executionResult);
  const timeoutNote = executionResult.timedOut ? { executionError: `Timed out after ${timeoutMs}ms` } : {};
  const report = { status, ...groupBuildDiagnostics(rawDiagnostics, executionResult), ...timeoutNote, ...sharedRunField(line.shared) };

  if (isJson) {
    if (shouldPrint) {
      process.stdout.write(formatJsonBuildReport(report) + '\n');
    }
    if (isCli) process.exit(toExitCode(status));
    return report;
  }

  const terminalOutput = formatTerminalBuildReport(report, { silent: isSilent, summary: isSummary });
  const shouldPrintReport = Boolean(terminalOutput) && shouldPrint;
  if (shouldPrintReport) {
    process.stdout.write(terminalOutput);
  }

  // A failing user build is the user's problem, not a chemx crash: only prepare an issue
  // report when asked (--prep-issue / --post-issue).
  const isFailedBuild = status === STATUS.FAIL;
  const hasIssueFlag = Boolean(parsed.flags.prepIssue || parsed.flags.postIssue);
  const shouldHandleError = isFailedBuild && (hasIssueFlag || options.postIssue);

  if (shouldHandleError) {
    const errorDetails = `Build command failed with exit code ${report.exitCode}: ${command}`;
    await handleError(new Error(errorDetails), {
      cwd,
      command,
      exitCode: report.exitCode,
      autoPost: Boolean(parsed.flags.postIssue || options.postIssue),
      prepIssue: true,
      silent: isSilent || isJson,
      context: {
        totalErrors: report.totalErrors,
        totalWarnings: report.totalWarnings,
        categories: report.categories
      }
    });
  }

  if (isCli) {
    process.exit(toExitCode(status));
  }

  return report;
};

export * from './build/types.js';
