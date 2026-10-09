// Text rendering for `chemx test`. One headline per verdict, so the counts never contradict it.
import { ANSI } from './theme.js';
import { STATUS } from './result-status.js';

export const TEST_HELP = [
  `${ANSI.BOLD}USAGE${ANSI.RESET}`,
  '  chemx test [targets...] [options] [-- <command>]',
  '',
  `${ANSI.BOLD}TARGETS${ANSI.RESET}`,
  '  Any positional argument is passed to the runner as a target (file path, or a',
  '  file-name filter for vitest/jest). A target that matches nothing is inconclusive.',
  '',
  `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
  '  -t <name>, -t=<name>     Only run tests whose name matches (alias: --filter)',
  '  --target=<path>          Explicit target (same as a positional)',
  '  --allow-empty            Treat a run that collects zero tests as a pass',
  '  --timeout=<seconds>      Stop the run after this long (result: inconclusive)',
  '  --json                   Output the test summary as JSON',
  '  --raw                    Stream the runner output as it runs',
  '  -h, --help               Show this help message',
  '',
  `${ANSI.BOLD}EXIT CODES${ANSI.RESET}`,
  '  0 pass, 1 fail, 3 inconclusive (no tests ran, timeout)',
  ''
].join('\n');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const formatTestHeadline = (report) => {
  const skippedNote = report.skipped > 0 ? `, ${report.skipped} skipped` : '';
  if (report.status === STATUS.PASS) {
    const isEmptyAllowed = report.passed === 0;
    if (isEmptyAllowed) return `${ANSI.DIM}-${ANSI.RESET} ${ANSI.BOLD}No tests ran (allowed by --allow-empty)${ANSI.RESET}`;
    return `${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}All tests passed${ANSI.RESET} ${ANSI.DIM}(${report.passed} passed${skippedNote} in ${report.durationMs}ms)${ANSI.RESET}`;
  }
  if (report.status === STATUS.INCONCLUSIVE) {
    const why = report.executionError || report.detail || report.reason;
    return `${ANSI.YELLOW}?${ANSI.RESET} ${ANSI.BOLD}Inconclusive: ${report.reason}${ANSI.RESET} ${ANSI.DIM}(${why})${ANSI.RESET}`;
  }
  const isUsageError = report.reason === 'USAGE';
  if (isUsageError) return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Usage error:${ANSI.RESET} ${report.executionError}`;
  const hasOnlyExecutionError = report.executionError && report.failures.length === 0;
  if (hasOnlyExecutionError) {
    return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test command failed (exit ${report.exitCode}):${ANSI.RESET} ${report.executionError}`;
  }
  const didNotStart = report.failures.some((f) => f.kind === 'startup-error') && report.failed === 0;
  if (didNotStart) return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test runner failed to start:${ANSI.RESET} ${report.executionError}`;
  const errorNote = report.errors > 0 ? `, ${plural(report.errors, 'unhandled error')}` : '';
  return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test Failures (${report.failed} failed${errorNote} out of ${report.totalTests})${ANSI.RESET}`;
};

export const formatTestReport = (report) => {
  const out = [`  ${formatTestHeadline(report)}`];
  const isFailure = report.status === STATUS.FAIL;
  if (isFailure) {
    for (const failure of report.failures.slice(0, 5)) {
      out.push(`    ${ANSI.RED}✖ ${failure.name}${ANSI.RESET}`);
      for (const line of (failure.details || []).slice(0, 3)) out.push(`      ${ANSI.DIM}${line}${ANSI.RESET}`);
    }
    const hiddenCount = report.failures.length - 5;
    if (hiddenCount > 0) out.push(`    ${ANSI.DIM}...and ${hiddenCount} more${ANSI.RESET}`);
  }
  const showsCommand = report.status !== STATUS.PASS;
  if (showsCommand) out.push(`  ${ANSI.DIM}[${report.command}]${ANSI.RESET}`);
  return `${out.join('\n')}\n`;
};
