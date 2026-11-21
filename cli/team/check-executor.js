/**
 * The drain worker's default executor: runs a queued check through the existing audit for its kind
 * (runTypecheckAudit, runTestAudit, runProjectVerify, runBuildAudit). Those go through runInLine, so the job line
 * stays the one-heavy-at-a-time arbiter. Modules load lazily: enqueueing never pays for them.
 *
 * Cancellation: the worker hands the executor an AbortSignal. It is installed as the request signal
 * (request-context.js), which executeBuild honours by killing the check's whole process group, and which the
 * job line honours while the check waits for its turn. Aborting therefore stops the real typecheck, test or build.
 */

import { runWithRequestContext } from '../request-context.js';

const MAX_COLLECTED = 200;
const MAX_DEPTH = 4;
const MAX_DETAIL_CHARS = 300;

const detailsOf = (item) => (Array.isArray(item?.details) ? item.details.map(String).join(' ').slice(0, MAX_DETAIL_CHARS) : '');

/** One fault as { file, line, code, message }. A failed test ({ name, details[] }) keeps its name as the location and its details as the message. */
const asFault = (item, prefix = '') => {
  const rawFile = String(item?.file || item?.path || item?.name || '');
  const isPrefixed = prefix !== '' && rawFile !== '' && item?.name !== rawFile;
  return {
    file: isPrefixed ? `${prefix}/${rawFile}` : rawFile,
    line: Number(item?.line || 0),
    code: String(item?.code || item?.rule || ''),
    message: String(item?.message || item?.error || item?.title || detailsOf(item) || (typeof item === 'string' ? item : ''))
  };
};

const FAULT_LISTS = ['errors', 'failures', 'failedTests'];
const SECTIONS = ['typecheck', 'tests', 'build', 'audit'];

const isErrorDiagnostic = (item) => item?.severity === undefined || item.severity === 'error';

const listOf = (report, key) => (Array.isArray(report[key]) ? report[key] : []);

const packagePrefix = (entry) => (entry?.dir && entry.dir !== '.' ? String(entry.dir) : '');

/**
 * Every fault a report carries, flattened. Besides a report's own lists it descends into a verify summary's
 * sections and into a workspace report's `packages` (each a full report; its faults get the package dir as a path prefix).
 */
export const collectFaults = (report, depth = 0, prefix = '') => {
  const faults = [];
  const isObject = report !== null && typeof report === 'object';
  const isSkipped = !isObject || depth > MAX_DEPTH;
  if (isSkipped) return faults;
  for (const key of FAULT_LISTS) faults.push(...listOf(report, key).map((item) => asFault(item, prefix)));
  faults.push(...listOf(report, 'diagnostics').filter(isErrorDiagnostic).map((item) => asFault(item, prefix)));
  for (const section of SECTIONS) faults.push(...collectFaults(report[section], depth + 1, prefix));
  for (const entry of listOf(report, 'packages')) faults.push(...collectFaults(entry, depth + 1, packagePrefix(entry) || prefix));
  return faults.slice(0, MAX_COLLECTED);
};

const numberOf = (report) => Number(report?.errorCount ?? report?.totalErrors ?? report?.failed);

/** The report's own fault count, summed over workspace packages and verify sections when it carries none itself. */
const countOf = (report, depth = 0) => {
  const isObject = report !== null && typeof report === 'object';
  const isSkipped = !isObject || depth > MAX_DEPTH;
  const own = isSkipped ? 0 : numberOf(report);
  const hasOwnCount = own > 0;
  const children = isSkipped ? [] : [...listOf(report, 'packages'), ...SECTIONS.map((key) => report[key])];
  return hasOwnCount ? own : children.reduce((sum, child) => sum + countOf(child, depth + 1), 0);
};

const messageOf = (report) => String(report?.executionError || report?.error || report?.detail || '');

/** The first reason any workspace package or verify section gives, since the top-level report of a workspace run has none. */
const summaryOf = (report) => {
  const own = messageOf(report);
  if (own) return own;
  const children = [...listOf(report, 'packages'), ...SECTIONS.map((key) => report?.[key])];
  const reason = children.map((child) => ({ child, text: messageOf(child) })).find((entry) => entry.text);
  if (!reason) return '';
  const name = reason.child.package || reason.child.dir || '';
  return name ? `${name}: ${reason.text}` : reason.text;
};

export const toCheckResult = (report, startedAt) => {
  const faults = collectFaults(report);
  const status = ['pass', 'fail', 'inconclusive'].includes(report?.status) ? report.status : 'inconclusive';
  const count = Math.max(countOf(report), faults.length);
  return { status, exitCode: report?.exitCode ?? null, durationMs: Date.now() - startedAt, errorCount: count, faults: faults.slice(0, 25), more: Math.max(0, count - 25), summaryLine: summaryOf(report) };
};

const loadRunners = async () => {
  const [{ runTypecheckAudit }, { runTestAudit }, { runProjectVerify }, { runBuildAudit }] = await Promise.all([
    import('../typecheck-audit.js'), import('../test-audit.js'), import('../verify.js'), import('../build.js')
  ]);
  return { typecheck: runTypecheckAudit, test: runTestAudit, verify: runProjectVerify, build: runBuildAudit };
};

/**
 * @param runners optional { kind: (args, isCli, options) => report } override (specs inject it).
 * The returned executor is (job, { signal }) => result; aborting `signal` kills the check's process tree.
 */
export const createCheckExecutor = (runners = null) => async (job, { signal = null } = {}) => {
  const startedAt = Date.now();
  const table = runners || await loadRunners();
  const run = table[job.kind];
  if (!run) return { status: 'inconclusive', summaryLine: `unknown check kind: ${job.kind}`, faults: [], errorCount: 0, durationMs: 0 };
  const report = await runWithRequestContext({ signal }, () => run(['--json'], false, { cwd: job.cwd, print: false, json: true }));
  return toCheckResult(report, startedAt);
};
