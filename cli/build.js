import { detectProjectBuildCommand, findProjectRoot } from './build/detector.js';
import { executeBuild } from './build/executor.js';
import { parseBuildOutput } from './build/parser.js';
import { groupBuildDiagnostics } from './build/grouper.js';
import { formatTerminalBuildReport, formatJsonBuildReport } from './build/reporter.js';
import { ANSI } from './theme.js';
import { handleError } from './errors/index.js';

const IGNORED_COMMAND_TOKENS = new Set(['build', 'run', 'wrap']);

const isCommandCandidate = (arg) => !arg.startsWith('-') && !IGNORED_COMMAND_TOKENS.has(arg);

const parseCommandFromArgs = (args) => {
  const dashDashIndex = args.indexOf('--');
  if (dashDashIndex !== -1) {
    const afterDash = args.slice(dashDashIndex + 1).join(' ').trim();
    if (afterDash.length > 0) return afterDash;
  }

  const candidate = args.find(isCommandCandidate);
  return candidate ? candidate.trim() : null;
};

export const runBuildAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const isJson = rawArgs.includes('--json') || options.json === true;
  const isSilent = rawArgs.includes('--silent') || options.silent === true;
  const isRaw = rawArgs.includes('--raw') || options.raw === true;
  const isSummary = rawArgs.includes('--summary') || options.summary === true;
  const shouldPrint = options.print !== false;
  const cwd = findProjectRoot(options.cwd || process.cwd());

  const customCommand = parseCommandFromArgs(rawArgs) || options.command;
  const command = detectProjectBuildCommand(customCommand, cwd);

  const shouldPrintStart = shouldPrint && !isJson && !isSilent && !isRaw;
  if (shouldPrintStart) {
    process.stdout.write(`${ANSI.CYAN}Auditing build:${ANSI.RESET} ${ANSI.DIM}${command}${ANSI.RESET}\n`);
  }

  const executionResult = await executeBuild(command, cwd, { raw: isRaw });
  const rawDiagnostics = parseBuildOutput(executionResult.stdout, executionResult.stderr);
  const report = groupBuildDiagnostics(rawDiagnostics, executionResult);

  if (isJson) {
    if (shouldPrint) {
      process.stdout.write(formatJsonBuildReport(report) + '\n');
    }
    if (isCli) process.exit(report.exitCode);
    return report;
  }

  const terminalOutput = formatTerminalBuildReport(report, { silent: isSilent, summary: isSummary });
  if (terminalOutput && shouldPrint) {
    process.stdout.write(terminalOutput);
  }

  const isFailedBuild = report.exitCode !== 0;
  const hasIssueFlag = rawArgs.includes('--prep-issue') || rawArgs.includes('--post-issue');
  const shouldHandleError = isFailedBuild && (hasIssueFlag || options.postIssue || (isCli && !isJson));

  if (shouldHandleError) {
    const errorDetails = `Build command failed with exit code ${report.exitCode}: ${command}`;
    await handleError(new Error(errorDetails), {
      cwd,
      command,
      exitCode: report.exitCode,
      autoPost: rawArgs.includes('--post-issue') || options.postIssue,
      silent: isSilent || isJson,
      context: {
        totalErrors: report.totalErrors,
        totalWarnings: report.totalWarnings,
        categories: report.categories
      }
    });
  }

  if (isCli) {
    process.exit(report.exitCode);
  }

  return report;
};

export * from './build/types.js';
