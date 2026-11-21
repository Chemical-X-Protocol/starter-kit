/**
 * Delivers a finished check: a DM to every requester (PASS is one line; FAIL is the fault count and up to
 * 25 faults) and a board post only when it did not pass. A cancelled check is delivered as a one-line DM.
 * The sender is @check_runner, so the result reaches a requester whose session is gone: the DM waits in the inbox.
 *
 * Delivery is at-least-once and exception-safe: each requester is notified in its own try/catch and marked
 * notified (notified_at) only after the DM went out, the board post is recorded on the job so it happens once,
 * and redeliverUnnotified() sweeps finished jobs that still have an un-notified requester (the worker does it on
 * start), so a crash or a DM error between "result recorded" and "requesters told" loses nothing.
 */

import { sendDirectMessage } from './team-db-mailbox.js';
import { postFeedEvent } from './team-db-feed.js';
import { isDerivedHandle } from './agent-identity.js';
import { rowToJob } from './check-queue.js';

export const CHECK_RUNNER = '@check_runner';
export const MAX_FAULTS = 25;

// The process-scoped fallback handle (@agent-<pid>-<hex>) nobody reads. Older rows may still carry one.
const PHANTOM_HANDLE = /^@agent-\d+-[0-9a-f]{6}$/;

export const isPhantomHandle = (handle) => PHANTOM_HANDLE.test(String(handle || '')) || isDerivedHandle(handle);

const seconds = (ms) => `${(Math.max(0, ms || 0) / 1000).toFixed(1)}s`;

const faultLine = (fault) => {
  const where = fault.file ? `${fault.file}${fault.line ? `:${fault.line}` : ''}` : '';
  const code = fault.code ? ` ${fault.code}` : '';
  return `  ${where}${code} ${fault.message || ''}`.trimEnd();
};

export const formatPass = (job, result) => `check #${job.id} ${job.kind} PASS (${seconds(result.durationMs)})${result.stale ? ' [tree changed while it ran]' : ''}`;

export const formatCancelled = (job, result) => `check #${job.id} ${job.kind} CANCELLED${result.cancelledBy ? ` by ${result.cancelledBy}` : ''}; no result will come. Rerun: chemx team check ${job.kind}`;

export const formatFailure = (job, result) => {
  const faults = result.faults || [];
  const shown = faults.slice(0, MAX_FAULTS);
  const total = Math.max(result.errorCount || 0, faults.length);
  const hidden = total - shown.length;
  const verdict = result.status === 'inconclusive' ? 'INCONCLUSIVE' : 'FAIL';
  const head = `check #${job.id} ${job.kind} ${verdict}: ${total} fault(s)${result.summaryLine ? `. ${result.summaryLine}` : ''}${result.stale ? ' [tree changed while it ran]' : ''}`;
  const more = hidden > 0 ? [`  +${hidden} more (chemx team check show ${job.id})`] : [];
  return [head, ...shown.map(faultLine), ...more, `Rerun: chemx team check ${job.kind}`].join('\n');
};

const FORMATTERS = { cancelled: formatCancelled, pass: formatPass };

const messageFor = (job, result) => (FORMATTERS[result.status] || formatFailure)(job, result);

const hasBoardPost = (db, jobId) => db.prepare("SELECT json_extract(result, '$.boardPostedAt') AS at FROM check_jobs WHERE id = ?").get(jobId)?.at != null;

const markPosted = (db, jobId, now) => db.prepare("UPDATE check_jobs SET result = json_set(result, '$.boardPostedAt', ?) WHERE id = ?").run(now, jobId);

const markNotified = (db, jobId, agentId, now) => db.prepare('UPDATE check_requesters SET notified_at = ? WHERE job_id = ? AND agent_id = ?').run(now, jobId, agentId);

/**
 * Tells every requester not yet notified, and posts a non-passing result to the board once.
 * Returns { dms, posted, skipped, errors }: `errors` lists what failed and will be retried by the next sweep.
 */
export const deliverCheckResult = (db, job, result, { send = sendDirectMessage, post = postFeedEvent } = {}) => {
  const isPass = result.status === 'pass';
  const isCancelled = result.status === 'cancelled';
  const message = messageFor(job, result);
  const metadata = { checkId: job.id, kind: job.kind, status: result.status };
  const requesters = db.prepare('SELECT agent_id, task_id FROM check_requesters WHERE job_id = ? AND notified_at IS NULL ORDER BY agent_id').all(job.id);
  const now = Date.now();
  const outcome = { dms: 0, posted: false, skipped: 0, errors: [] };
  const shouldPost = !isPass && !isCancelled && !hasBoardPost(db, job.id);
  if (shouldPost) {
    try {
      post(db, { author_id: CHECK_RUNNER, event_type: 'check_result', message, metadata });
      markPosted(db, job.id, now);
      outcome.posted = true;
    } catch (error) {
      outcome.errors.push(`board post: ${error?.message || error}`);
    }
  }
  for (const requester of requesters) {
    if (isPhantomHandle(requester.agent_id)) {
      markNotified(db, job.id, requester.agent_id, now);
      outcome.skipped += 1;
      continue;
    }
    try {
      send(db, { author_id: CHECK_RUNNER, recipient_id: requester.agent_id, task_id: requester.task_id, message, metadata });
      markNotified(db, job.id, requester.agent_id, now);
      outcome.dms += 1;
    } catch (error) {
      outcome.errors.push(`dm ${requester.agent_id}: ${error?.message || error}`);
    }
  }
  return outcome;
};

/** Finished jobs that still have a requester nobody told: the work a crash or a DM error left behind. */
export const unnotifiedJobs = (db) => db.prepare("SELECT DISTINCT j.* FROM check_jobs j JOIN check_requesters r ON r.job_id = j.id WHERE j.status IN ('done', 'failed', 'cancelled') AND r.notified_at IS NULL ORDER BY j.id").all().map(rowToJob);

/**
 * Delivers every unnotified finished job through `deliver`; one job's error never stops the rest and leaves that job
 * un-notified for the next sweep. Returns { attempted, failures: [{ id, error }] }.
 */
export const redeliverUnnotified = (db, deliver) => {
  const jobs = unnotifiedJobs(db);
  const failures = [];
  for (const job of jobs) {
    try {
      deliver(db, job, job.result);
    } catch (error) {
      failures.push({ id: job.id, error: String(error?.message || error) });
    }
  }
  return { attempted: jobs.length, failures };
};
