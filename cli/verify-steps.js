// Step results for `chemx verify`. Every gate maps onto the tri-state contract; a step that
// does not apply to the project (no tsconfig, no typecheck script) is reported as skipped and
// left out of the combined verdict instead of being counted as a pass.
import { STATUS, combineStatuses } from './result-status.js';
import { TYPECHECK_REASONS } from './typecheck-command.js';

export const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
export const SKIPPED = 'skipped';

const LABELS = { audit: 'AST audit', typecheck: 'typecheck', tests: 'tests', build: 'build' };

export const typecheckStepStatus = (report) => {
  const isNotApplicable = report.reason === TYPECHECK_REASONS.NOT_APPLICABLE;
  return isNotApplicable ? SKIPPED : report.status;
};

export const buildSection = (buildReport) => ({
  status: buildReport.status,
  success: buildReport.status === STATUS.PASS,
  command: buildReport.command,
  exitCode: buildReport.exitCode,
  durationMs: buildReport.durationMs,
  totalDiagnostics: buildReport.counts?.total ?? 0,
  errors: buildReport.counts?.errors ?? 0,
  executionError: buildReport.executionError || null,
  rawTail: (buildReport.rawTail || []).slice(-5)
});

export const typecheckSection = (typeReport) => ({
  status: typecheckStepStatus(typeReport),
  success: typeReport.success,
  command: typeReport.command,
  reason: typeReport.reason || null,
  errorCount: typeReport.errorCount,
  executionError: typeReport.executionError || null,
  errors: typeReport.errors.slice(0, 5)
});

export const testsSection = (testReport) => ({
  status: testReport.status,
  success: testReport.success,
  command: testReport.command,
  reason: testReport.reason || null,
  total: testReport.totalTests,
  passed: testReport.passed,
  failed: testReport.failed,
  skipped: testReport.skipped,
  errors: testReport.errors || 0,
  executionError: testReport.executionError || null,
  failures: testReport.failures.slice(0, 3)
});

// stepStatuses: { audit, typecheck, tests, build? } where each value is a STATUS or SKIPPED.
export const combineStepStatuses = (stepStatuses) => {
  const counted = Object.values(stepStatuses).filter((status) => status && status !== SKIPPED);
  return combineStatuses(counted);
};

// Names each non-passing functional step so the warning never blames the wrong one.
export const describeUnprovenSteps = (stepStatuses) => Object.entries(stepStatuses)
  .filter(([name, status]) => name !== 'audit' && status && status !== SKIPPED && status !== STATUS.PASS)
  .map(([name, status]) => `${LABELS[name]} (${status})`);

export const architecturalWarningFor = (stepStatuses) => {
  const isAuditPassing = stepStatuses.audit === STATUS.PASS;
  const unproven = describeUnprovenSteps(stepStatuses);
  const needsWarning = isAuditPassing && unproven.length > 0;
  if (!needsWarning) return null;
  return `AST compliance does not guarantee functional correctness. Not proven: ${unproven.join(', ')}.`;
};
