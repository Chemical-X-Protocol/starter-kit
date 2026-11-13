/**
 * Delivers a finished check: a DM to every requester (PASS is one line; FAIL is the fault count and up
 * to 25 faults) and a board post only when it did not pass. The sender is @check_runner, so the
 * result reaches a requester whose session is gone: the DM waits in the inbox.
 */

import { sendDirectMessage } from './team-db-mailbox.js';
import { postFeedEvent } from './team-db-feed.js';

export const CHECK_RUNNER = '@check_runner';
export const MAX_FAULTS = 25;

const seconds = (ms) => `${(Math.max(0, ms || 0) / 1000).toFixed(1)}s`;

const faultLine = (fault) => {
  const where = fault.file ? `${fault.file}${fault.line ? `:${fault.line}` : ''}` : '';
  const code = fault.code ? ` ${fault.code}` : '';
  return `  ${where}${code} ${fault.message || ''}`.trimEnd();
};

export const formatPass = (job, result) => `check #${job.id} ${job.kind} PASS (${seconds(result.durationMs)})${result.stale ? ' [tree changed while it ran]' : ''}`;

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

export const deliverCheckResult = (db, job, result, { send = sendDirectMessage, post = postFeedEvent } = {}) => {
  const isPass = result.status === 'pass';
  const message = isPass ? formatPass(job, result) : formatFailure(job, result);
  const requesters = db.prepare('SELECT agent_id, task_id FROM check_requesters WHERE job_id = ?').all(job.id);
  const now = Date.now();
  for (const requester of requesters) {
    send(db, { author_id: CHECK_RUNNER, recipient_id: requester.agent_id, task_id: requester.task_id, message, metadata: { checkId: job.id, kind: job.kind, status: result.status } });
    db.prepare('UPDATE check_requesters SET notified_at = ? WHERE job_id = ? AND agent_id = ?').run(now, job.id, requester.agent_id);
  }
  if (!isPass) post(db, { author_id: CHECK_RUNNER, event_type: 'check_result', message, metadata: { checkId: job.id, kind: job.kind, status: result.status } });
  return { dms: requesters.length, posted: !isPass };
};
