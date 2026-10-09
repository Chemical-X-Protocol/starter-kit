// Text lines for `chemx verify`. Each step line is printed as soon as that step finishes,
// so a slow step never leaves the terminal showing only the banner.
import { ANSI } from './theme.js';
import { STATUS } from './result-status.js';
import { isInteractive } from './terminal.js';
import { SKIPPED } from './verify-steps.js';

export const VERIFY_HELP = [
  `${ANSI.BOLD}USAGE${ANSI.RESET}`,
  '  chemx verify [options]',
  '',
  `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
  '  --dir=<path>             Target directory to verify (default: .chemxrc "scope", else project root)',
  '  --build                  Include production build audit step',
  '  --timeout=<seconds>      Per-step timeout for typecheck, tests and build (default 600)',
  '  --allow-empty            Accept a test run that collects zero tests',
  '  --profile=<name>         Rule profile for the AST audit',
  '  --json                   Output summary status card as JSON',
  '  -h, --help               Show this help message',
  '',
  `${ANSI.BOLD}EXIT CODES${ANSI.RESET}`,
  '  0 pass, 1 fail, 3 inconclusive (no tests ran, missing checker, step timeout)',
  ''
].join('\n');

const ICONS = {
  [STATUS.PASS]: `${ANSI.LIME}✔${ANSI.RESET}`,
  [STATUS.FAIL]: `${ANSI.RED}✖${ANSI.RESET}`,
  [STATUS.INCONCLUSIVE]: `${ANSI.YELLOW}?${ANSI.RESET}`,
  [SKIPPED]: `${ANSI.DIM}-${ANSI.RESET}`
};

const pad = (label) => `${label}:`.padEnd(19);

export const stepLine = (status, label, text, dimNote = '') => {
  const note = dimNote ? ` ${ANSI.DIM}[${dimNote}]${ANSI.RESET}` : '';
  return `  ${ICONS[status] || ICONS[STATUS.FAIL]} ${pad(label)}${text}${note}\n`;
};

export const formatTypecheckStep = (section) => {
  if (section.status === SKIPPED) return 'Skipped (no typecheck script or tsconfig.json)';
  if (section.status === STATUS.PASS) return 'Clean (0 errors)';
  if (section.status === STATUS.INCONCLUSIVE) return `Inconclusive (${section.executionError || section.reason})`;
  if (section.errorCount === 0) return `Command Failed (${section.executionError})`;
  return `${section.errorCount} error(s)`;
};

const isEmptyAllowed = (section) => section.status === STATUS.PASS && section.reason === 'EMPTY_ALLOWED';

// An empty run that --allow-empty accepted passes the gate but proves nothing, so no green check.
export const testStepIcon = (section) => (isEmptyAllowed(section) ? SKIPPED : section.status);

export const formatTestStep = (section) => {
  if (isEmptyAllowed(section)) return 'No tests ran (allowed by --allow-empty)';
  const skippedNote = section.skipped > 0 ? `, ${section.skipped} skipped` : '';
  if (section.status === STATUS.PASS) return `Passed (${section.passed}/${section.total}${skippedNote})`;
  if (section.status === STATUS.INCONCLUSIVE) return `Inconclusive: ${section.reason} (${section.passed} ran${skippedNote})`;
  const isBareFailure = section.failed === 0 && section.errors === 0 && section.executionError;
  if (isBareFailure) return `Command Failed (${section.executionError})`;
  const errorNote = section.errors > 0 ? `, ${section.errors} unhandled error(s)` : '';
  return `${section.failed} failed${errorNote}`;
};

export const formatBuildStep = (section) => {
  if (section.status === STATUS.PASS) return `Success (${section.totalDiagnostics} diagnostics)`;
  if (section.status === STATUS.INCONCLUSIVE) return `Inconclusive (${section.executionError || 'timed out'})`;
  return `Failed (exit ${section.exitCode}, ${section.errors} error(s))`;
};

// On an interactive terminal, shows a transient "running" line that the step result replaces.
export const createProgress = (shouldPrint) => {
  const isLive = shouldPrint && isInteractive();
  return {
    start: (label) => {
      if (isLive) process.stdout.write(`  ${ANSI.DIM}… ${pad(label)}running${ANSI.RESET}`);
    },
    finish: (line) => {
      if (isLive) process.stdout.write('\r\x1b[K');
      if (shouldPrint) process.stdout.write(line);
    }
  };
};

export const formatVerdict = (status, warning) => {
  if (status === STATUS.PASS) return `\n  ${ANSI.LIME}${ANSI.BOLD}All verification checks passed with zero context burn!${ANSI.RESET}\n\n`;
  const headline = status === STATUS.INCONCLUSIVE
    ? `${ANSI.YELLOW}${ANSI.BOLD}Verification inconclusive: a step could not prove its result.${ANSI.RESET}`
    : `${ANSI.RED}${ANSI.BOLD}Verification failed. Actionable issues cataloged above.${ANSI.RESET}`;
  const notice = warning ? `\n  ${ANSI.YELLOW}⚠ Notice: ${warning}${ANSI.RESET}` : '';
  return `\n  ${headline}${notice}\n\n`;
};
