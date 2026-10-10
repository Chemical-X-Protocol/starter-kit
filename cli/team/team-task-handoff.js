/**
 * Chemical X Protocol: task handoff.
 * `chemx team task handoff <taskId> <@to> --as=<@from>` moves a task between agents.
 * The current assignee or the task creator (the author of its task_created event) may hand off.
 * The task stays in_progress, and the move is recorded as a task_handoff feed event.
 */

import { resolveAgentIdentity } from './agent-identity.js';
import { normalizeAgentId } from './team-db-task-helpers.js';
import { getTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { postFeedEvent } from './team-db-feed.js';
import { withImmediateTransaction } from './team-db-transaction.js';
import { findDispatcherRun } from './team-dispatcher-authority.js';

export const HANDOFF_USAGE = 'chemx team task handoff <taskId> <@to> --as=<@from> [--with-locks]';

export const findTaskCreator = (db, taskId) => {
  const row = db.prepare("SELECT author_id FROM agent_feed WHERE task_id = ? AND event_type = 'task_created' ORDER BY id ASC LIMIT 1").get(Number(taskId));
  return row?.author_id || null;
};

const HANDOFF_RULES = [
  { reason: 'task_not_found', test: (c) => !c.task, say: (c) => `Task #${c.taskId} not found.` },
  { reason: 'already_done', test: (c) => c.task?.status === 'done', say: (c) => `Task #${c.taskId} is already done.` },
  { reason: 'same_assignee', test: (c) => c.task?.assigned_agent_id === c.to, say: (c) => `Task #${c.taskId} is already assigned to ${c.to}.` },
  {
    reason: 'not_authorized',
    test: (c) => c.by !== c.task?.assigned_agent_id && c.by !== c.creator && !c.dispatcherRun,
    say: (c) => `${c.by} may not hand off task #${c.taskId}: only its assignee (${c.task?.assigned_agent_id || 'none'}) or its creator (${c.creator || 'unknown'}) can.`
  }
];

export const evaluateHandoff = (ctx) => {
  const broken = HANDOFF_RULES.find((rule) => rule.test(ctx));
  const isAllowed = !broken;
  return isAllowed ? { allowed: true } : { allowed: false, reason: broken.reason, message: broken.say(ctx) };
};

// A lease names the task when its purpose holds `#<id>` not followed by another digit (#57 does not match #5740).
const namesTask = (purpose, taskId) => new RegExp(`#${Number(taskId)}(?!\\d)`).test(String(purpose ?? ''));

// Moves every live lease whose purpose names the task to the new owner (only with --with-locks). Expired leases are left alone.
const transferLeases = (db, taskId, to) => {
  const now = Date.now();
  const live = db.prepare('SELECT file_path, locked_by, purpose FROM file_leases WHERE expires_at > ?').all(now);
  const named = live.filter((lease) => namesTask(lease.purpose, taskId) && lease.locked_by !== to);
  const move = db.prepare('UPDATE file_leases SET locked_by = ? WHERE file_path = ?');
  for (const lease of named) move.run(to, lease.file_path);
  return named.map((lease) => ({ file_path: lease.file_path, from: lease.locked_by }));
};

export const handoffTask = (db, taskId, toHandle, byHandle, options = {}) => {
  const to = normalizeAgentId(toHandle);
  const by = normalizeAgentId(byHandle);
  const hasArgs = Boolean(db) && Boolean(taskId) && Boolean(to) && Boolean(by);
  if (!hasArgs) return { success: false, reason: 'missing_args', message: `Usage: ${HANDOFF_USAGE}` };

  registerAgent(db, { id: to, role: 'executor' });
  const result = withImmediateTransaction(db, () => {
    const task = getTask(db, taskId);
    const dispatcherRun = findDispatcherRun(db, task, by);
    const verdict = evaluateHandoff({ task, taskId, to, by, creator: findTaskCreator(db, taskId), dispatcherRun });
    const isDenied = !verdict.allowed;
    if (isDenied) return { success: false, reason: verdict.reason, message: verdict.message };

    const from = task.assigned_agent_id || null;
    const hasPreviousOwner = Boolean(from);
    db.prepare("UPDATE agent_tasks SET assigned_agent_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?").run(to, Date.now(), Number(taskId));
    if (hasPreviousOwner) db.prepare("UPDATE agents SET current_task_id = NULL, status = 'idle' WHERE id = ? AND current_task_id = ?").run(from, Number(taskId));
    db.prepare("UPDATE agents SET current_task_id = ?, status = 'busy' WHERE id = ?").run(Number(taskId), to);
    const movedLeases = options.withLocks === true ? transferLeases(db, taskId, to) : [];
    return { success: true, from, to, by, dispatcherRun, movedLeases, task: getTask(db, taskId) };
  });
  const isRefused = !result.success;
  if (isRefused) return result;

  const label = result.from || 'unassigned';
  postFeedEvent(db, {
    author_id: by,
    recipient_id: to,
    task_id: Number(taskId),
    event_type: 'task_handoff',
    message: `Handoff task #${taskId}: ${label} -> ${to} (by ${by}${result.dispatcherRun ? `, by dispatcher of run ${result.dispatcherRun}` : ''})`,
    metadata: { from: result.from, to, by, ...(result.dispatcherRun ? { dispatcher_run: result.dispatcherRun } : {}) }
  });
  for (const lease of result.movedLeases) {
    postFeedEvent(db, {
      author_id: by,
      recipient_id: to,
      task_id: Number(taskId),
      event_type: 'lock_transferred',
      file_path: lease.file_path,
      message: `Lease on ${lease.file_path} moved ${lease.from} -> ${to} with task #${taskId} (by ${by}, --with-locks)`,
      metadata: { from: lease.from, to, by }
    });
  }
  return result;
};

const printHandoffResult = (res, taskId, isJson) => {
  const moved = res.movedLeases?.length ? ` (moved ${res.movedLeases.length} live lease(s) whose purpose names #${taskId})` : '';
  const okLine = `\x1b[32m✔\x1b[0m Handed off task #${taskId}: ${res.from || 'unassigned'} -> ${res.to}${moved}\n`;
  const failLine = `\x1b[31m✕ Handoff failed: ${res.message}\x1b[0m\n`;
  const stream = res.success ? process.stdout : process.stderr;
  const humanLine = res.success ? okLine : failLine;
  const text = isJson ? `${JSON.stringify(res, null, 2)}\n` : humanLine;
  stream.write(text);
  process.exitCode = res.success ? 0 : 1;
};

export const handleTaskHandoffCommand = (db, positional, flags, isCli) => {
  const [, taskId, toHandle] = positional;
  const identity = resolveAgentIdentity(flags.as);
  const isAnonymous = identity.source === 'process';
  const res = isAnonymous
    ? { success: false, reason: 'as_required', message: `--as=<@from> is required. Usage: ${HANDOFF_USAGE}` }
    : handoffTask(db, taskId, toHandle, identity.id, { withLocks: flags.withLocks === true });
  if (isCli) printHandoffResult(res, taskId, flags.isJson);
  return res;
};
