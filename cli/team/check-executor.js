/**
 * The drain worker's default executor: runs a queued check through the existing audit for its kind
 * (runTypecheckAudit, runTestAudit, runProjectVerify, runBuildAudit). Those go through runInLine, so the job line
 * stays the one-heavy-at-a-time arbiter. Modules load lazily: enqueueing never pays for them.
 */

const MAX_COLLECTED = 200;

const asFault = (item) => ({
  file: String(item?.file || item?.path || item?.name || ''),
  line: Number(item?.line || 0),
  code: String(item?.code || item?.rule || ''),
  message: String(item?.message || item?.error || item?.title || (typeof item === 'string' ? item : ''))
});

const FAULT_LISTS = ['errors', 'failures', 'failedTests'];

const isErrorDiagnostic = (item) => item?.severity === undefined || item.severity === 'error';

const listOf = (report, key) => (Array.isArray(report[key]) ? report[key] : []);

/** Every fault a report (or a verify summary's sections) carries, flattened to { file, line, code, message }. */
export const collectFaults = (report, depth = 0) => {
  const faults = [];
  const isObject = report !== null && typeof report === 'object';
  const isTooDeep = depth > 2;
  const isSkipped = !isObject || isTooDeep;
  if (isSkipped) return faults;
  for (const key of FAULT_LISTS) faults.push(...listOf(report, key).map(asFault));
  faults.push(...listOf(report, 'diagnostics').filter(isErrorDiagnostic).map(asFault));
  for (const section of [report.typecheck, report.tests, report.build, report.audit]) faults.push(...collectFaults(section, depth + 1));
  return faults.slice(0, MAX_COLLECTED);
};

export const toCheckResult = (report, startedAt) => {
  const faults = collectFaults(report);
  const status = ['pass', 'fail', 'inconclusive'].includes(report?.status) ? report.status : 'inconclusive';
  const count = Number(report?.errorCount ?? report?.totalErrors ?? faults.length) || faults.length;
  const summaryLine = String(report?.executionError || report?.error || report?.detail || '');
  return { status, exitCode: report?.exitCode ?? null, durationMs: Date.now() - startedAt, errorCount: count, faults: faults.slice(0, 25), more: Math.max(0, count - 25), summaryLine };
};

const loadRunners = async () => {
  const [{ runTypecheckAudit }, { runTestAudit }, { runProjectVerify }, { runBuildAudit }] = await Promise.all([
    import('../typecheck-audit.js'), import('../test-audit.js'), import('../verify.js'), import('../build.js')
  ]);
  return { typecheck: runTypecheckAudit, test: runTestAudit, verify: runProjectVerify, build: runBuildAudit };
};

/** @param runners optional { kind: (args, isCli, options) => report } override (specs inject it). */
export const createCheckExecutor = (runners = null) => async (job) => {
  const startedAt = Date.now();
  const table = runners || await loadRunners();
  const run = table[job.kind];
  if (!run) return { status: 'inconclusive', summaryLine: `unknown check kind: ${job.kind}`, faults: [], errorCount: 0, durationMs: 0 };
  const report = await run(['--json'], false, { cwd: job.cwd, print: false, json: true });
  return toCheckResult(report, startedAt);
};
