// Parses test runner output into counts, failures and a tri-state verdict.
// A run only PASSES when at least one test ran and nothing failed; zero collected tests,
// a filter that matched nothing, or a timeout is INCONCLUSIVE (exit 3), never a green check.
import { stripAnsi } from './terminal.js';
import { STATUS } from './result-status.js';
import { noteCounterfactual } from './telemetry/call-ledger.js';
import {
  extractAssertionFailures,
  extractUnhandledErrors,
  findFatalLine,
  findFailingTodos,
  findFirstErrorLine,
  findNoTestsLine,
  tailLines
} from './test-failures.js';

export const REASONS = Object.freeze({
  NO_TESTS_RAN: 'NO_TESTS_RAN',
  STEP_TIMEOUT: 'STEP_TIMEOUT',
  EMPTY_ALLOWED: 'EMPTY_ALLOWED'
});

const TEST_FILE_NAME = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$|\.(?:c|m)?[jt]sx?$/;

// node --test reports a file that ran no tests (for example a name pattern matched nothing)
// as one passing pseudo-test named after the file, preceded by a `1..0` plan in TAP mode,
// or as a passing test named after the spec file in spec reporter mode.
const isTapEmptyNodeFile = (line, index, cleanLines) => {
  const isEmptyPlan = line === '1..0';
  const subtest = (cleanLines[index + 1] || '').match(/^# Subtest: (.+)$/);
  const okLine = cleanLines[index + 2] || '';
  const isSubtestSpec = Boolean(subtest && TEST_FILE_NAME.test(subtest[1]));
  const isOkSubtest = Boolean(subtest && okLine.endsWith(`- ${subtest[1]}`));
  return isEmptyPlan && isSubtestSpec && isOkSubtest;
};

const isSpecEmptyNodeFile = (line) => {
  const match = line.match(/^[✔✓]\s+(\S+)\s+\([\d.]+m?s\)$/);
  return Boolean(match && TEST_FILE_NAME.test(match[1]));
};

const countEmptyNodeFiles = (cleanLines) => {
  const tapCount = cleanLines.filter((l, i) => isTapEmptyNodeFile(l, i, cleanLines)).length;
  const hasTapCount = tapCount > 0;
  if (hasTapCount) return tapCount;
  return cleanLines.filter(isSpecEmptyNodeFile).length;
};

const readNumber = (line, pattern) => {
  const match = line.match(pattern);
  return match ? parseInt(match[1], 10) : null;
};

const parseCounts = (cleanLines) => {
  const counts = { totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, todo: 0 };
  let hasRunnerSummary = false;
  for (const line of cleanLines) {
    const isRunnerSummary = /^Tests:?\s+/i.test(line);
    if (isRunnerSummary) {
      counts.passed = readNumber(line, /(\d+)\s+passed/i) ?? 0;
      counts.failed = readNumber(line, /(\d+)\s+failed/i) ?? 0;
      counts.skipped = readNumber(line, /(\d+)\s+(?:skipped|todo|pending)/i) ?? 0;
      counts.totalTests = readNumber(line, /\((\d+)\)/) ?? readNumber(line, /(\d+)\s+total/i) ?? counts.passed + counts.failed + counts.skipped;
      hasRunnerSummary = true;
      continue;
    }
    const errorCount = readNumber(line, /^Errors\s+(\d+)\s+errors?/i);
    const hasErrorCount = errorCount !== null;
    if (hasErrorCount) counts.errors = errorCount;
    if (hasRunnerSummary) continue;
    const nodeCount = (name) => readNumber(line, new RegExp(`^(?:[ℹ#]\\s+)?${name}\\s+(\\d+)$`, 'i'));
    counts.totalTests = nodeCount('tests') ?? counts.totalTests;
    counts.passed = nodeCount('pass') ?? counts.passed;
    counts.failed = (nodeCount('fail') ?? counts.failed);
    counts.failed += nodeCount('cancelled') ?? 0;
    const todoCount = nodeCount('todo') ?? 0;
    counts.todo += todoCount;
    counts.skipped += (nodeCount('skipped') ?? 0) + todoCount;
  }
  const emptyNodeFiles = hasRunnerSummary ? 0 : countEmptyNodeFiles(cleanLines);
  counts.passed = Math.max(0, counts.passed - emptyNodeFiles);
  counts.totalTests = Math.max(0, counts.totalTests - emptyNodeFiles);
  return counts;
};

const applyMarkerFallback = (counts, cleanLines) => {
  const checkmarks = cleanLines.filter((l) => /^(?:✔|✓)/.test(l) && !isSpecEmptyNodeFile(l)).length;
  const crosses = cleanLines.filter((l) => /^(?:✖|×|✗|✕)/.test(l) || l.startsWith('FAIL ')).length;
  const hasUncountedPasses = counts.passed === 0 && checkmarks > 0;
  if (hasUncountedPasses) counts.passed = checkmarks;
  const hasUncountedFailures = counts.failed === 0 && crosses > 0 && counts.totalTests === 0;
  if (hasUncountedFailures) counts.failed = crosses;
  const countedTotal = counts.passed + counts.failed + counts.skipped;
  const isTotalUnderReported = counts.totalTests < counts.passed + counts.failed;
  const isTotalMissing = counts.totalTests === 0 || isTotalUnderReported;
  if (isTotalMissing) counts.totalTests = countedTotal;
};

// An empty run is only genuine when the runner exited cleanly, said itself that it found no
// tests, or collected tests and skipped them all. Anything else is a runner that never started.
const isGenuinelyEmpty = (counts, noTestsLine, exitCode) => exitCode === 0 || Boolean(noTestsLine) || counts.skipped > 0;

const classifyEmptyRun = ({ counts, noTestsLine, exitCode, options, lines }) => {
  const isCrash = !isGenuinelyEmpty(counts, noTestsLine, exitCode);
  if (isCrash) return { status: STATUS.FAIL, reason: null, executionError: findFirstErrorLine(lines) || `Command exited with code ${exitCode}` };
  const status = options.allowEmpty ? STATUS.PASS : STATUS.INCONCLUSIVE;
  const reason = options.allowEmpty ? REASONS.EMPTY_ALLOWED : REASONS.NO_TESTS_RAN;
  const detail = noTestsLine || `0 tests ran (${counts.skipped} skipped)`;
  return { status, reason, executionError: null, detail };
};

const classify = ({ counts, failures, fatalLine, noTestsLine, exitCode, options, lines }) => {
  const isTimedOut = Boolean(options.timedOut);
  if (isTimedOut) return { status: STATUS.INCONCLUSIVE, reason: REASONS.STEP_TIMEOUT, executionError: `Timed out after ${options.timeoutMs || '?'}ms` };
  if (fatalLine) return { status: STATUS.FAIL, reason: null, executionError: fatalLine };
  const startupError = failures.find((f) => f.kind === 'startup-error');
  const hasFailures = counts.failed > 0 || counts.errors > 0 || failures.length > 0;
  if (hasFailures) return { status: STATUS.FAIL, reason: null, executionError: startupError?.message ?? null };
  // The runner's own "no tests" line only explains an empty run; a test *named* after it must not cause one.
  const isEmptyRun = counts.passed + counts.failed === 0;
  if (isEmptyRun) return classifyEmptyRun({ counts, noTestsLine, exitCode, options, lines });
  const exitedDirty = exitCode !== 0;
  if (exitedDirty) {
    const tail = tailLines(lines, 10);
    const errorLine = tail.find((l) => /error|not found|failed/i.test(l)) || tail[tail.length - 1];
    return { status: STATUS.FAIL, reason: null, executionError: errorLine || `Command exited with code ${exitCode}` };
  }
  return { status: STATUS.PASS, reason: null, executionError: null };
};

export const parseTestOutput = (stdout = '', stderr = '', exitCode = 0, options = {}) => {
  noteCounterfactual('raw-output', { chars: String(stdout).length + String(stderr).length });
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => stripAnsi(l));
  const cleanLines = lines.map((l) => l.trim()).filter(Boolean);
  const counts = parseCounts(cleanLines);
  applyMarkerFallback(counts, cleanLines);

  const assertionFailures = (exitCode !== 0 || counts.failed > 0) ? extractAssertionFailures(lines) : [];
  const failures = [...assertionFailures, ...extractUnhandledErrors(lines)];
  const hasUnnamedFailures = counts.failed > 0 && assertionFailures.length === 0;
  if (hasUnnamedFailures) {
    failures.unshift({ kind: 'assertion', name: `${counts.failed} failing test(s), names not parsed`, message: null, location: null, details: tailLines(lines, 10) });
  }
  const hasNoErrorCount = counts.errors === 0;
  if (hasNoErrorCount) counts.errors = failures.filter((f) => f.kind === 'unhandled-error').length;

  const verdict = classify({
    counts, failures, lines, exitCode, options,
    fatalLine: findFatalLine(String(stderr).split(/\r?\n/).map((l) => stripAnsi(l))),
    noTestsLine: findNoTestsLine(lines, { scoped: Boolean(options.scoped) })
  });

  const todoFailing = findFailingTodos(lines).length;
  return { success: verdict.status === STATUS.PASS, ...verdict, ...counts, todoFailing, failures };
};
