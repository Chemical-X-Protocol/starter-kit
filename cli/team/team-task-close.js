/**
 * Chemical X Protocol: task close (#2575).
 * `chemx team task close <id> --duplicate-of=<id> | --cancel=<reason> --as=<@me>` ends a task that
 * will not be completed, without the done gate. Same authority as handoff: the current assignee or
 * the task creator. The terminal status is 'duplicate' or 'cancelled'; the default task list shows
 * only open statuses, and dispatch only hands out queued tasks, so neither returns it. The close is
 * recorded as a task_closed feed event whose metadata carries the duplicate link.
 */

import { resolveAgentIdentity } from './agent-identity.js';
import { normalizeAgentId } from './team-db-task-helpers.js';
import { getTask } from './team-db-tasks.js';
import { postFeedEvent } from './team-db-feed.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { findTaskCreator } from './team-task-handoff.js';
import { findDispatcherRun } from './team-dispatcher-authority.js';

export const CLOSE_USAGE = 'chemx team task close <id> --duplicate-of=<id> | --cancel=<reason> --as=<@me>';
export const CLOSED_STATUSES = ['duplicate', 'cancelled'];

const toTaskId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const CLOSE_RULES = [
  { reason: 'task_not_found', test: (c) => !c.task, say: (c) => `Task #${c.taskId} not found.` },
  { reason: 'already_done', test: (c) => c.task?.status === 'done', say: (c) => `Task #${c.taskId} is already done.` },
  { reason: 'already_closed', test: (c) => CLOSED_STATUSES.includes(c.task?.status), say: (c) => `Task #${c.taskId} is already closed (${c.task.status}).` },
  { reason: 'self_duplicate', test: (c) => c.duplicateOf === c.taskId, say: (c) => `Task #${c.taskId} cannot be a duplicate of itself.` },
  { reason: 'duplicate_target_not_found', test: (c) => c.duplicateOf && !c.target, say: (c) => `Duplicate target #${c.duplicateOf} not found.` },
  {
    reason: 'not_authorized',
    test: (c) => c.by !== c.task?.assigned_agent_id && c.by !== c.creator && !c.dispatcherRun,
    say: (c) => `${c.by} may not close task #${c.taskId}: only its assignee (${c.task?.assigned_agent_id || 'none'}) or its creator (${c.creator || 'unknown'}) can.`
  }
];

export const closeTask = (db, taskId, options, byHandle) => {
  const by = normalizeAgentId(byHandle);
  const duplicateOf = options?.duplicateOf ? toTaskId(options.duplicateOf) : null;
  const cancelReason = typeof options?.cancel === 'string' ? options.cancel.trim() : '';
  const hasDuplicate = Boolean(duplicateOf);
  const hasCancel = cancelReason.length > 0;
  const hasOneMode = hasDuplicate !== hasCancel;
  const hasArgs = Boolean(db) && Boolean(toTaskId(taskId)) && Boolean(by) && hasOneMode;
  if (!hasArgs) return { success: false, reason: 'missing_args', message: `Usage: ${CLOSE_USAGE} (exactly one of --duplicate-of or --cancel)` };

  const id = toTaskId(taskId);
  const result = withImmediateTransaction(db, () => {
    const task = getTask(db, id);
    const ctx = { task, taskId: id, by, duplicateOf, target: hasDuplicate ? getTask(db, duplicateOf) : null, creator: findTaskCreator(db, id), dispatcherRun: findDispatcherRun(db, task, by) };
    const broken = CLOSE_RULES.find((rule) => rule.test(ctx));
    const isDenied = Boolean(broken);
    if (isDenied) return { success: false, reason: broken.reason, message: broken.say(ctx) };

    const status = hasDuplicate ? 'duplicate' : 'cancelled';
    db.prepare('UPDATE agent_tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
    const owner = task.assigned_agent_id;
    const hasOwner = Boolean(owner);
    if (hasOwner) db.prepare("UPDATE agents SET current_task_id = NULL, status = 'idle' WHERE id = ? AND current_task_id = ?").run(owner, id);
    return { success: true, status, by, duplicateOf, dispatcherRun: ctx.dispatcherRun, reason: hasCancel ? cancelReason : null };
  });
  const isRefused = !result.success;
  if (isRefused) return result;

  const via = result.dispatcherRun ? `, by dispatcher of run ${result.dispatcherRun}` : '';
  const message = hasDuplicate ? `Closed task #${id} as a duplicate of #${duplicateOf} (by ${by}${via})` : `Cancelled task #${id}: ${cancelReason} (by ${by}${via})`;
  postFeedEvent(db, {
    author_id: by,
    task_id: id,
    event_type: 'task_closed',
    message,
    metadata: { status: result.status, duplicate_of: duplicateOf, reason: result.reason, by, ...(result.dispatcherRun ? { dispatcher_run: result.dispatcherRun } : {}) }
  });
  return { ...result, task: getTask(db, id) };
};

// Link lines for `task show`: what this task duplicates, and which closed tasks duplicate it.
export const duplicateLinks = (db, taskId) => {
  const id = toTaskId(taskId);
  const canRead = Boolean(db) && Boolean(id);
  if (!canRead) return { duplicateOf: null, duplicates: [] };
  const rows = db.prepare("SELECT task_id, metadata FROM agent_feed WHERE event_type = 'task_closed' ORDER BY id ASC").all();
  let duplicateOf = null;
  const duplicates = [];
  for (const row of rows) {
    let meta = {};
    try {
      meta = JSON.parse(row.metadata || '{}');
    } catch { // chemx-allow: best-effort a malformed feed row carries no link
      continue;
    }
    const target = toTaskId(meta.duplicate_of);
    const isThisClosed = row.task_id === id && Boolean(target);
    const isTargetOfOther = target === id && row.task_id !== id;
    if (isThisClosed) duplicateOf = target;
    if (isTargetOfOther) duplicates.push(row.task_id);
  }
  return { duplicateOf, duplicates: [...new Set(duplicates)] };
};

export const formatDuplicateLinks = ({ duplicateOf, duplicates }) => {
  const lines = [];
  const hasOriginal = Boolean(duplicateOf);
  const hasDuplicates = duplicates.length > 0;
  if (hasOriginal) lines.push(`  duplicate of #${duplicateOf}`);
  if (hasDuplicates) lines.push(`  duplicates: ${duplicates.map((n) => `#${n}`).join(', ')}`);
  const hasLines = lines.length > 0;
  return hasLines ? `${lines.join('\n')}\n` : '';
};

const printCloseResult = (res, taskId, isJson) => {
  const detail = res.duplicateOf ? `duplicate of #${res.duplicateOf}` : `cancelled: ${res.reason}`;
  const okLine = `\x1b[32m✔\x1b[0m Closed task #${taskId} (${detail})\n`;
  const failLine = `\x1b[31m✕ Close failed: ${res.message}\x1b[0m\n`;
  const stream = res.success ? process.stdout : process.stderr;
  const humanLine = res.success ? okLine : failLine;
  stream.write(isJson ? `${JSON.stringify(res, null, 2)}\n` : humanLine);
  process.exitCode = res.success ? 0 : 1;
};

export const handleTaskCloseCommand = (db, positional, flags, isCli) => {
  const taskId = positional[1];
  const identity = resolveAgentIdentity(flags.as);
  const isAnonymous = identity.source === 'process';
  const res = isAnonymous
    ? { success: false, reason: 'as_required', message: `--as=<@me> is required. Usage: ${CLOSE_USAGE}` }
    : closeTask(db, taskId, { duplicateOf: flags.duplicateOf, cancel: flags.cancel }, identity.id);
  if (isCli) printCloseResult(res, taskId, flags.isJson);
  return res;
};
