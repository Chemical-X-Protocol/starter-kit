/**
 * Chemical X Protocol: read and print a pull request's checks and merge state for `chemx ci` (#6760).
 * Reads `gh pr checks --json` and `gh pr view --json` through a gh runner (ci-gh.js). Verdict: any
 * failed or cancelled check is `fail`; else any pending is `pending`; no checks at all is `none`
 * (GitHub is sometimes slow to start them); else `pass`. A skipped check neither passes nor fails.
 */
import { MISSING_GH, jsonOf, firstLine } from './ci-gh.js';

export const CHECK_FIELDS = 'name,state,bucket,startedAt,completedAt,workflow,link';
export const VIEW_FIELDS = 'number,state,url,headRefName,mergeStateStatus,mergeable,autoMergeRequest,reviewDecision';

const BUCKET_OF_STATE = {
  SUCCESS: 'pass', NEUTRAL: 'pass', SKIPPED: 'skipping', FAILURE: 'fail', ERROR: 'fail', TIMED_OUT: 'fail', STALE: 'fail',
  ACTION_REQUIRED: 'fail', STARTUP_FAILURE: 'fail', CANCELLED: 'cancel', IN_PROGRESS: 'pending', QUEUED: 'pending',
  PENDING: 'pending', EXPECTED: 'pending', WAITING: 'pending', REQUESTED: 'pending'
};
const WORD_OF_BUCKET = { pass: 'pass', fail: 'FAIL', pending: 'pending', skipping: 'skipped', cancel: 'cancel' };
const FAILING = new Set(['fail', 'cancel']);

// gh reports a check that has not started or finished with the year-one zero date.
const timeOf = (iso) => {
  const time = Date.parse(iso);
  const isReal = Number.isFinite(time) && !String(iso).startsWith('0001-');
  return isReal ? time : null;
};

const normalizeCheck = (raw, now) => {
  const started = timeOf(raw.startedAt);
  const completed = timeOf(raw.completedAt);
  const isQueued = started === null;
  const isRunning = !isQueued && completed === null;
  const finished = completed === null ? now : completed;
  return {
    name: raw.name,
    state: raw.state,
    bucket: raw.bucket || BUCKET_OF_STATE[raw.state] || 'pending',
    durationMs: isQueued ? null : Math.max(0, finished - started),
    running: isRunning,
    link: raw.link || ''
  };
};

export const verdictOf = (checks) => {
  const isEmpty = checks.length === 0;
  const hasFailure = checks.some((check) => FAILING.has(check.bucket));
  const hasPending = checks.some((check) => check.bucket === 'pending');
  const verdicts = [[isEmpty, 'none'], [hasFailure, 'fail'], [hasPending, 'pending']];
  return (verdicts.find(([applies]) => applies) ?? [true, 'pass'])[1];
};

const pad2 = (n) => String(n).padStart(2, '0');

const fmtDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const forms = { hours: `${hours}h${pad2(minutes % 60)}m`, minutes: `${minutes}m${pad2(seconds % 60)}s`, seconds: `${seconds}s` };
  return forms[(hours > 0 && 'hours') || (minutes > 0 && 'minutes') || 'seconds'];
};

export const renderCheck = (check) => {
  const isQueued = check.durationMs === null;
  const duration = isQueued ? 'queued' : `${fmtDuration(check.durationMs)}${check.running ? '+' : ''}`;
  const linkText = FAILING.has(check.bucket) && check.link ? `  ${check.link}` : '';
  return `${WORD_OF_BUCKET[check.bucket].padEnd(8)}${duration.padStart(8)}  ${check.name}${linkText}`;
};

const normalizeMerge = (raw) => {
  const method = String(raw.autoMergeRequest?.mergeMethod ?? '').toLowerCase();
  const autoMerge = raw.autoMergeRequest ? (method || 'on') : null;
  return {
    pr: { number: raw.number ?? null, state: raw.state ?? '', url: raw.url ?? '', branch: raw.headRefName ?? '' },
    merge: { mergeStateStatus: raw.mergeStateStatus ?? '', mergeable: raw.mergeable ?? '', autoMerge, reviewDecision: raw.reviewDecision ?? '' }
  };
};

export const renderMerge = ({ pr, merge }) => {
  const auto = merge.autoMerge === null ? 'off' : `on (${merge.autoMerge})`;
  return `PR #${pr.number} ${pr.state.toLowerCase()}: merge state ${merge.mergeStateStatus}, mergeable ${merge.mergeable}, auto-merge ${auto}, review ${merge.reviewDecision || 'none'}`;
};

// gh exits 1 with this message on stderr (nothing on stdout) when a PR has no checks yet.
const NO_CHECKS = /no checks reported/i;

const readChecks = (reply, now) => {
  if (reply.missing) return { error: MISSING_GH };
  const listed = jsonOf(reply);
  if (Array.isArray(listed)) return { checks: listed.map((raw) => normalizeCheck(raw, now)) };
  const isNone = NO_CHECKS.test(`${reply.stderr}${reply.stdout}`);
  return isNone ? { checks: [] } : { error: `gh pr checks failed: ${firstLine(reply)}` };
};

/**
 * @param {Function} gh a gh runner
 * @param {{ target: string|null, repo: string|null }} opts
 * @param {number} now ms clock, for the age of a check still running
 * @returns {{ checks: object[], pr: object, merge: object, verdict: string } | { error: string }}
 */
export const readSnapshot = (gh, opts, now) => {
  const scope = [...(opts.target ? [opts.target] : []), ...(opts.repo ? ['--repo', opts.repo] : [])];
  const read = readChecks(gh(['pr', 'checks', ...scope, '--json', CHECK_FIELDS]), now);
  if (read.error) return read;
  const viewReply = gh(['pr', 'view', ...scope, '--json', VIEW_FIELDS]);
  const viewed = viewReply.ok ? jsonOf(viewReply) : null;
  const failure = viewReply.missing ? MISSING_GH : `gh pr view failed: ${firstLine(viewReply)}`;
  if (!viewed) return { error: failure };
  return { checks: read.checks, ...normalizeMerge(viewed), verdict: verdictOf(read.checks) };
};

const stateKey = (check) => `${check.state}/${check.bucket}`;

/**
 * The lines to print for a snapshot: all of them the first time (previous is null), afterwards only the
 * checks whose state changed and the merge line if it changed, so a --wait prints changes only.
 */
export const snapshotLines = (snapshot, previous = null) => {
  const before = new Map((previous?.checks ?? []).map((check) => [check.name, stateKey(check)]));
  const changed = snapshot.checks.filter((check) => before.get(check.name) !== stateKey(check));
  const wasNone = previous !== null && previous.checks.length === 0;
  const isNone = snapshot.checks.length === 0;
  const announcesNone = isNone && (previous === null || !wasNone);
  const mergeLine = renderMerge(snapshot);
  const mergeChanged = previous === null || renderMerge(previous) !== mergeLine;
  return [...(announcesNone ? ['no checks reported'] : []), ...changed.map(renderCheck), ...(mergeChanged ? [mergeLine] : [])];
};

export const snapshotJson = (snapshot) => ({
  verdict: snapshot.verdict,
  pr: snapshot.pr,
  checks: snapshot.checks.map(({ name, state, bucket, durationMs, link }) => ({ name, state, bucket, durationMs, link })),
  merge: snapshot.merge
});
