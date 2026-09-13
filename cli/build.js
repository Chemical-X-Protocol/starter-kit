import { detectProjectBuildCommand } from './build/detector.js';
import { executeBuild } from './build/executor.js';
import { parseBuildOutput } from './build/parser.js';
import { groupBuildDiagnostics } from './build/grouper.js';
import { formatTerminalBuildReport, formatJsonBuildReport } from './build/reporter.js';
import { ANSI } from './theme.js';

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

export const runBuildAudit = async (rawArgs = [], isCli = false) => {
  const isJson = rawArgs.includes('--json');
  const isSilent = rawArgs.includes('--silent');
  const isRaw = rawArgs.includes('--raw');
  const isSummary = rawArgs.includes('--summary');

  const customCommand = parseCommandFromArgs(rawArgs);
  const command = detectProjectBuildCommand(customCommand, process.cwd());

  const shouldPrintStart = !isJson && !isSilent && !isRaw;
  if (shouldPrintStart) {
    process.stdout.write(`${ANSI.CYAN}Auditing build:${ANSI.RESET} ${ANSI.DIM}${command}${ANSI.RESET}\n`);
  }

  const executionResult = await executeBuild(command, process.cwd(), { raw: isRaw });
  const rawDiagnostics = parseBuildOutput(executionResult.stdout, executionResult.stderr);
  const report = groupBuildDiagnostics(rawDiagnostics, executionResult);

  if (isJson) {
    process.stdout.write(formatJsonBuildReport(report) + '\n');
    if (isCli) process.exit(report.exitCode);
    return report;
  }

  const terminalOutput = formatTerminalBuildReport(report, { silent: isSilent, summary: isSummary });
  if (terminalOutput) {
    process.stdout.write(terminalOutput);
  }

  if (isCli) {
    process.exit(report.exitCode);
  }

  return report;
};

export * from './build/types.js';
