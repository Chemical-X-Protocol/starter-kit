// What `chemx lint` reports: the ESLint result, the micro-check hazards of the named paths, and the
// one line that says ESLint did not run. The text is for people, the JSON for agents (K12, #6757).
import { ANSI } from './theme.js';
import { formatAgentJson } from './agent-json.js';
import { formatMicroText, microRows } from './lint-micro.js';

const DISPLAY_LIMIT = 10;

/** The report of a run that could not use ESLint: only the micro-checks ran (command 'chemx check'). */
export const fallbackReport = ({ fallback, note }) => ({
  success: true,
  exitCode: 0,
  command: 'chemx check',
  durationMs: 0,
  errorCount: 0,
  warningCount: 0,
  fixableCount: 0,
  executionError: null,
  errors: [],
  warnings: [],
  fallback,
  note
});

/** Folds the micro-check result into a report. named: { missing, skipped }, the typed paths that do not exist or are not source. */
export const withMicro = (report, micro, { missing = [], skipped = [] } = {}) => {
  const success = report.success && micro.isClean && missing.length === 0;
  return {
    ...report,
    success,
    exitCode: success ? 0 : report.exitCode || 1,
    micro: { checked: micro.checked, hazardCount: micro.hazardCount, criticalCount: micro.criticalCount, highMedCount: micro.highMedCount },
    hazards: microRows(micro),
    ...(missing.length > 0 ? { missing } : {}),
    ...(skipped.length > 0 ? { skipped } : {})
  };
};

const eslintFailureText = (report) => {
  const hasExecutionError = Boolean(report.executionError);
  if (hasExecutionError) return `\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Lint Execution Error:${ANSI.RESET} ${report.executionError}\n\n`;
  const warningSuffix = report.warningCount > 0 ? `, ${report.warningCount} warning(s)` : '';
  const plural = report.errorCount === 1 ? '' : 's';
  const lines = [`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Lint Failures (${report.errorCount} error${plural}${warningSuffix})${ANSI.RESET}`];
  for (const err of report.errors.slice(0, DISPLAY_LIMIT)) {
    lines.push(`    ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${err.file}:${err.line}:${err.column}${ANSI.RESET} ${err.message} ${ANSI.DIM}(${err.ruleId})${ANSI.RESET}`);
  }
  const hiddenErrors = report.errors.length - DISPLAY_LIMIT;
  const hasHiddenErrors = hiddenErrors > 0;
  if (hasHiddenErrors) lines.push(`    ${ANSI.DIM}...and ${hiddenErrors} more error(s)${ANSI.RESET}`);
  const hasFixable = report.fixableCount > 0;
  if (hasFixable) lines.push('', `  ${ANSI.CYAN}💡 ${report.fixableCount} issue(s) potentially fixable with 'chemx lint --fix'${ANSI.RESET}`);
  return `${lines.join('\n')}\n\n`;
};

// ESLint's own verdict: a failed run always carries an error row or an execution error, so a report
// with neither passed ESLint, even when the micro-checks below it made the whole report fail.
const eslintText = (report) => {
  const hasEslintFailure = report.errorCount > 0 || Boolean(report.executionError);
  if (hasEslintFailure) return eslintFailureText(report);
  const warnInfo = report.warningCount > 0 ? ` with ${report.warningCount} warning(s)` : '';
  return `  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}Linter passed${warnInfo}${ANSI.RESET} ${ANSI.DIM}(in ${report.durationMs}ms)${ANSI.RESET}\n`;
};

/** The text view: the note (or the ESLint result), each missing or skipped path, then the hazards in check's own shape. */
export const lintText = (report, micro) => {
  const head = report.note ? `  ${ANSI.DIM}${report.note}${ANSI.RESET}\n` : eslintText(report);
  const missing = (report.missing ?? []).map((target) => `  ${ANSI.RED}✕${ANSI.RESET} File not found: ${target}\n`);
  const skipped = report.skipped ? [`  ${ANSI.DIM}skipped (not a source file chemx audits): ${report.skipped.join(', ')}${ANSI.RESET}\n`] : [];
  return head + missing.join('') + skipped.join('') + (micro ? formatMicroText(micro) : '');
};

/** Prints the report (JSON for agents, text for people) unless print is off. */
export const printLintReport = (report, micro, { isJson, shouldPrint }) => {
  if (!shouldPrint) return;
  process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : lintText(report, micro));
};
