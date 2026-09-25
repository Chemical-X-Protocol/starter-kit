/**
 * Chemical X Protocol: Swarm CLI Command Handlers
 * Parses arguments and dispatches actions for team status, feed, tasks, and locks
 */

import { openIndexDb } from '../search-db.js';
import { toColumnar } from '../columnar.js';
import {
  getSwarmStatus,
  queryFeed,
  postFeedEvent,
  listTasks,
  getTask,
  createTask,
  claimTask,
  updateTaskStatus,
  registerAgent
} from './team-db.js';
import { getAgentMailbox, sendDirectMessage } from './team-db-mailbox.js';
import { autoGenerateTasksFromAudit, completeTaskWithAudit, queryUnassignedHazards, reconcileAuditTasks } from './team-triage.js';
import { formatSwarmStatusCard, formatFeedTimeline, formatTaskListCard, formatMailboxCard, formatTaskDetailCard, formatTeamHelpCard, formatTaskHelpCard } from './team-format.js';
import { getSwarmTokenBreakdown, formatTokenBreakdownCard } from './team-tokens.js';
import { runAblationComparison, formatAblationCard } from './team-memory.js';
import { parseFlags } from './team-flags.js';
import { handleTaskSlotCommand, handleTaskTraceCommand, handleTrainCommand } from './team-commands-vds.js';
import { handleLockCommand, handleUnlockCommand } from './team-commands-lock.js';

const ARG_VAL_FLAGS = ['--target', '--as', '--to', '--agent', '--since', '--limit', '--thread', '--task', '--parent', '--rule', '--priority', '--prio', '--moscow', '--url', '--pid'];

export const runTeamCli = (rawArgs = [], isCli = false, cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  if (!db) {
    if (isCli) process.stderr.write('\x1b[31m✕ SQLite database unavailable.\x1b[0m\n');
    return null;
  }

  const subCommand = rawArgs[0] || 'status';
  const restArgs = rawArgs.slice(1);
  const flags = parseFlags(restArgs);
  const nonFlagPositional = [];
  for (let i = 0; i < restArgs.length; i++) {
    const a = restArgs[i];
    if (a.startsWith('-')) continue;
    const isVal = i > 0 && ARG_VAL_FLAGS.includes(restArgs[i - 1]);
    if (isVal) continue;
    nonFlagPositional.push(a);
  }

  const isTeamHelp = subCommand === '--help' || subCommand === '-h' || subCommand === 'help' || (subCommand === 'status' && flags.help);
  if (isTeamHelp) {
    if (isCli) process.stdout.write(formatTeamHelpCard());
    return { help: true, commands: ['status', 'task', 'lock', 'unlock', 'feed', 'post', 'inbox', 'dm', 'tokens', 'triage', 'benchmark', 'train'] };
  }

  if (subCommand === 'status') {
    const status = getSwarmStatus(db);
    if (flags.isJson) {
      const output = {
        agents: status.agents,
        tasks: status.tasks,
        locks: {
          active: status.locks.active,
          waiting: status.locks.waiting,
          leases: toColumnar(status.locks.leases, ['file_path', 'locked_by', 'expires_at'])
        },
        tokens: status.tokens,
        blockedTasks: toColumnar(status.blockedTasks, ['id', 'title', 'assigned_agent_id', 'blocked_reason']),
        recentFeed: toColumnar(status.recentFeed, ['id', 'timestamp', 'author_id', 'event_type', 'message'])
      };
      if (isCli) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return output;
    }
    if (isCli) process.stdout.write(formatSwarmStatusCard(status));
    return status;
  }

  if (subCommand === 'tokens' || subCommand === 'telemetry') {
    const breakdown = getSwarmTokenBreakdown(db);
    if (flags.isJson) {
      if (isCli) process.stdout.write(`${JSON.stringify(breakdown, null, 2)}\n`);
      return breakdown;
    }
    if (isCli) process.stdout.write(formatTokenBreakdownCard(breakdown));
    return breakdown;
  }

  if (subCommand === 'feed') {
    const events = queryFeed(db, {
      since_id: flags.since,
      thread_id: flags.thread,
      task_id: flags.task,
      event_type: flags.type,
      agent_id: flags.agent
    });
    if (flags.isJson) {
      const col = toColumnar(events, ['id', 'timestamp', 'author_id', 'recipient_id', 'event_type', 'file_path', 'message']);
      if (isCli) process.stdout.write(`${JSON.stringify(col, null, 2)}\n`);
      return col;
    }
    if (isCli) process.stdout.write(formatFeedTimeline(events));
    return events;
  }

  if (subCommand === 'post') {
    const msg = nonFlagPositional.join(' ') || 'Status check';
    const ev = postFeedEvent(db, {
      author_id: flags.as || '@agent',
      recipient_id: flags.to || null,
      thread_id: flags.thread || null,
      task_id: flags.task || null,
      event_type: flags.type || 'broadcast',
      message: msg,
      metadata: flags.metadata || {}
    });
    if (isCli) {
      if (flags.isJson) process.stdout.write(`${JSON.stringify(ev, null, 2)}\n`);
      else process.stdout.write(`\x1b[32m✔\x1b[0m Posted event #${ev.id} to feed\n`);
    }
    return ev;
  }

  if (subCommand === 'task') {
    const isTaskHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
    if (isTaskHelp) {
      if (isCli) process.stdout.write(formatTaskHelpCard());
      return { help: true, actions: ['list', 'show', 'add', 'claim', 'done', 'update', 'comment', 'triage', 'reconcile', 'set-target', 'vds-slot', 'trace'] };
    }
    const taskAction = nonFlagPositional[0] || 'list';
    if (taskAction === 'list') {
      const tasks = listTasks(db, {
        status: flags.status,
        assigned_agent_id: flags.agent,
        parentId: flags.parent,
        rule: flags.rule,
        priority: flags.priority
      });
      if (flags.isJson) {
        const col = toColumnar(tasks, ['id', 'title', 'tier', 'status', 'priority', 'assigned_agent_id', 'target_path', 'parent_id']);
        if (isCli) process.stdout.write(`${JSON.stringify(col, null, 2)}\n`);
        return col;
      }
      if (isCli) {
        process.stdout.write(formatTaskListCard(tasks));
      }
      return tasks;
    }
    const isShowAction = ['show', 'view', 'info'].includes(taskAction);
    if (isShowAction) {
      const taskId = nonFlagPositional[1];
      if (!taskId) {
        if (isCli) process.stderr.write('\x1b[31m✕ Task ID required: chemx team task show <id>\x1b[0m\n');
        return { error: 'taskId required' };
      }
      const task = getTask(db, taskId);
      if (!task) {
        if (isCli) process.stderr.write(`\x1b[31m✕ Task #${taskId} not found\x1b[0m\n`);
        return { error: `Task #${taskId} not found` };
      }
      const events = queryFeed(db, { task_id: taskId });
      if (flags.isJson) {
        const output = { task, events, activityCount: events.length };
        if (isCli) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return output;
      }
      if (isCli) {
        process.stdout.write(formatTaskDetailCard(task, events));
      }
      return { task, events };
    }
    if (taskAction === 'comment' || taskAction === 'post') {
      const taskId = nonFlagPositional[1];
      if (!taskId) {
        if (isCli) process.stderr.write('\x1b[31m✕ Task ID required: chemx team task comment <id> <message>\x1b[0m\n');
        return { error: 'taskId required' };
      }
      const msg = nonFlagPositional.slice(2).join(' ') || flags.message;
      if (!msg) {
        if (isCli) process.stderr.write('\x1b[31m✕ Message required\x1b[0m\n');
        return { error: 'message required' };
      }
      const authorHandle = flags.as || '@agent';
      registerAgent(db, { id: authorHandle, role: 'contributor' });
      const ev = postFeedEvent(db, {
        author_id: authorHandle,
        task_id: Number(taskId),
        event_type: flags.type || 'status_update',
        message: msg
      });
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(ev, null, 2)}\n`);
        else process.stdout.write(`\x1b[32m✔\x1b[0m Posted update to task #${taskId}: ${msg}\n`);
      }
      return ev;
    }
    const isVdsSlot = taskAction === 'vds-slot' || taskAction === 'slot';
    if (isVdsSlot) {
      const taskId = nonFlagPositional[1];
      const moscow = nonFlagPositional[2] || flags.moscow || 'must';
      const prio = nonFlagPositional[3] || flags.priority || 'critical';
      return handleTaskSlotCommand(db, taskId, moscow, prio, isCli, flags.isJson);
    }
    const isTrace = taskAction === 'trace';
    if (isTrace) {
      const taskId = nonFlagPositional[1];
      const url = nonFlagPositional[2] || flags.url;
      return handleTaskTraceCommand(db, taskId, url, isCli, flags.isJson);
    }
    if (taskAction === 'claim') {
      const taskId = nonFlagPositional[1];
      const agentHandle = flags.as || '@agent';
      registerAgent(db, { id: agentHandle, role: 'executor' });
      const res = claimTask(db, taskId, agentHandle);
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        else if (res.success) process.stdout.write(`\x1b[32m✔\x1b[0m Claimed task #${taskId}\n`);
        else process.stderr.write(`\x1b[31m✕ Claim failed: ${res.reason}\x1b[0m\n`);
      }
      return res;
    }
    if (taskAction === 'done' || taskAction === 'complete') {
      const taskId = nonFlagPositional[1];
      const agentHandle = flags.as || '@agent';
      registerAgent(db, { id: agentHandle, role: 'executor' });
      const tokensOption = (flags.tokens || flags.promptTokens || flags.completionTokens || flags.cost) ? {
        prompt: flags.promptTokens || flags.tokens || 0,
        completion: flags.completionTokens || 0,
        cached: flags.cachedTokens || 0,
        cost_usd: flags.cost,
        model: flags.model
      } : undefined;

      const res = completeTaskWithAudit(db, taskId, agentHandle, {
        cwd,
        target: flags.target,
        force: flags.force,
        noTargetConfirm: flags.noTargetConfirm,
        tokens: tokensOption
      });

      if (isCli) {
        if (flags.isJson) {
          process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        } else if (res?.refused) {
          if (res.noTarget) {
            process.stderr.write(`\x1b[31m✕ ${res.message}\x1b[0m\n`);
          } else {
            process.stderr.write(`\x1b[31m✕ Cannot complete task #${taskId}: ${res.hazardCount} hazard(s) remain in ${res.targetPath}. Fix the hazards or pass --force to complete anyway.\x1b[0m\n`);
          }
        } else if (res?.result_payload?.verificationApplicable === false) {
          process.stdout.write(`\x1b[33m⚠\x1b[0m Completed task #${taskId} (Unverified: no target_path specified; completed with --no-target-confirm)\n`);
        } else if (res?.result_payload?.forced) {
          process.stdout.write(`\x1b[33m⚠\x1b[0m Completed task #${taskId} with --force \x1b[33m(Note: ${res.result_payload.hazardCountAfter} hazard(s) still remain in ${res.target_path})\x1b[0m\n`);
        } else if (res?.result_payload?.verified && (res?.result_payload?.hazardCountAfter || 0) === 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Completed task #${taskId} (Verified clean: 0 hazards in ${res.target_path || 'target'})\n`);
        } else if (res?.result_payload?.verified && (res?.result_payload?.hazardCountAfter || 0) > 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Completed task #${taskId} (Verified passing: ${res.result_payload.hazardCountAfter} non-blocking warning(s) remain in ${res.target_path})\n`);
        } else if (res?.result_payload?.hazardCountAfter > 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Completed task #${taskId} \x1b[33m(Note: ${res.result_payload.hazardCountAfter} hazard(s) still remain in ${res.target_path})\x1b[0m\n`);
        } else {
          process.stdout.write(`\x1b[32m✔\x1b[0m Completed task #${taskId}\n`);
        }
      }
      return res;
    }
    if (taskAction === 'update') {
      const taskId = nonFlagPositional[1];
      const targetStatus = flags.status || nonFlagPositional[2] || 'in_progress';
      const agentHandle = flags.as || '@agent';
      registerAgent(db, { id: agentHandle, role: 'executor' });

      let res;
      if (targetStatus === 'done' || targetStatus === 'completed') {
        const tokensOption = (flags.tokens || flags.promptTokens || flags.completionTokens || flags.cost) ? {
          prompt: flags.promptTokens || flags.tokens || 0,
          completion: flags.completionTokens || 0,
          cached: flags.cachedTokens || 0,
          cost_usd: flags.cost,
          model: flags.model
        } : undefined;

        res = completeTaskWithAudit(db, taskId, agentHandle, {
          cwd,
          target: flags.target,
          force: flags.force,
          noTargetConfirm: flags.noTargetConfirm,
          tokens: tokensOption
        });
      } else {
        res = updateTaskStatus(db, taskId, targetStatus, { blockedReason: flags.reason || '' });
        if (res) {
          postFeedEvent(db, {
            author_id: agentHandle,
            task_id: Number(taskId),
            event_type: 'task_status_updated',
            message: `Updated task #${taskId} status to ${targetStatus}`
          });
        }
      }

      if (isCli) {
        if (flags.isJson) {
          process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        } else if (res?.refused) {
          if (res.noTarget) {
            process.stderr.write(`\x1b[31m✕ ${res.message}\x1b[0m\n`);
          } else {
            process.stderr.write(`\x1b[31m✕ Cannot complete task #${taskId}: ${res.hazardCount} hazard(s) remain in ${res.targetPath}. Fix the hazards or pass --force to complete anyway.\x1b[0m\n`);
          }
        } else if (res?.result_payload?.verificationApplicable === false) {
          process.stdout.write(`\x1b[33m⚠\x1b[0m Updated task #${taskId} to status "done" (Unverified: no target_path specified; completed with --no-target-confirm)\n`);
        } else if (res?.result_payload?.forced) {
          process.stdout.write(`\x1b[33m⚠\x1b[0m Updated task #${taskId} to status "done" with --force \x1b[33m(Note: ${res.result_payload.hazardCountAfter} hazard(s) still remain in ${res.target_path})\x1b[0m\n`);
        } else if (res?.result_payload?.verified && (res?.result_payload?.hazardCountAfter || 0) === 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Updated task #${taskId} to status "done" (Verified clean: 0 hazards in ${res.target_path || 'target'})\n`);
        } else if (res?.result_payload?.verified && (res?.result_payload?.hazardCountAfter || 0) > 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Updated task #${taskId} to status "done" (Verified passing: ${res.result_payload.hazardCountAfter} non-blocking warning(s) remain in ${res.target_path})\n`);
        } else if (res?.result_payload?.hazardCountAfter > 0) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Updated task #${taskId} to status "done" \x1b[33m(Note: ${res.result_payload.hazardCountAfter} hazard(s) still remain in ${res.target_path})\x1b[0m\n`);
        } else {
          process.stdout.write(`\x1b[32m✔\x1b[0m Updated task #${taskId} status to "${targetStatus}"\n`);
        }
      }
      return res;
    }
    const isCreateAction = ['create', 'add', 'new'].includes(taskAction);
    if (isCreateAction) {
      const title = nonFlagPositional.slice(1).join(' ') || 'Untitled Task';
      const authorHandle = flags.as || '@agent';
      registerAgent(db, { id: authorHandle, role: 'contributor' });
      if (flags.agent) {
        registerAgent(db, { id: flags.agent, role: 'executor' });
      }
      const task = createTask(db, {
        title,
        tier: flags.tier || 'molecule',
        target_path: flags.target,
        priority: flags.priority || 2,
        assigned_agent_id: flags.agent || null,
        parent_id: flags.parent ?? null
      });
      if (task) {
        postFeedEvent(db, {
          author_id: authorHandle,
          task_id: task.id,
          event_type: 'task_created',
          message: `Created task #${task.id}: ${task.title}`
        });
      }
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
        else process.stdout.write(`\x1b[32m✔\x1b[0m Created task #${task.id}: ${task.title}\n`);
      }
      return task;
    }
    if (taskAction === 'triage') {
      const tasks = autoGenerateTasksFromAudit(db, { cwd, maxTasks: flags.priority || 10 });
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
        else if (tasks.length > 0) process.stdout.write(`\x1b[32m✔\x1b[0m Triage generated ${tasks.length} task(s) from AST index\n`);
        else process.stdout.write('\x1b[34mℹ\x1b[0m Triage found 0 architectural hazards to convert into tasks. (All files compliant!)\n');
      }
      return tasks;
    }
    if (taskAction === 'reconcile' || taskAction === 'prune') {
      const resolved = reconcileAuditTasks(db, { cwd });
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
        else if (resolved.length > 0) process.stdout.write(`\x1b[32m✔\x1b[0m Reconciled and auto-resolved ${resolved.length} task(s) whose hazards were fixed.\n`);
        else process.stdout.write('\x1b[34mℹ\x1b[0m 0 tasks needed reconciliation.\n');
      }
      return resolved;
    }
    if (taskAction === 'set-target' || taskAction === 'target') {
      const taskId = nonFlagPositional[1];
      const targetPath = flags.target || nonFlagPositional[2];
      const hasTaskId = Boolean(taskId);
      const hasTargetPath = Boolean(targetPath);
      const canSet = hasTaskId && hasTargetPath;
      if (!canSet) {
        if (isCli) process.stderr.write('\x1b[31m✕ Usage: chemx team task set-target <taskId> <path>\x1b[0m\n');
        return { error: 'Usage: chemx team task set-target <taskId> <path>' };
      }
      db.prepare('UPDATE agent_tasks SET target_path = ?, updated_at = ? WHERE id = ?').run(targetPath, Date.now(), Number(taskId));
      const updated = getTask(db, taskId);
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
        else process.stdout.write(`\x1b[32m✔\x1b[0m Updated task #${taskId} target_path to ${targetPath}\n`);
      }
      return updated;
    }

    if (isCli) {
      process.stderr.write(`\x1b[31m✕ Unknown task action: "${taskAction}". Available actions: list, show, view, add, claim, done, update, comment, triage, reconcile, set-target\x1b[0m\n`);
    }
    return { error: `Unknown task action: ${taskAction}` };
  }

  if (subCommand === 'lock') {
    return handleLockCommand(db, nonFlagPositional, flags, isCli);
  }

  if (subCommand === 'unlock') {
    return handleUnlockCommand(db, nonFlagPositional, flags, isCli);
  }

  if (subCommand === 'triage') {
    const tasks = autoGenerateTasksFromAudit(db, { cwd, maxTasks: flags.priority || 10 });
    if (isCli) {
      if (flags.isJson) process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      else if (tasks.length > 0) process.stdout.write(`\x1b[32m✔\x1b[0m Triage generated ${tasks.length} task(s) from AST index\n`);
      else process.stdout.write('\x1b[34mℹ\x1b[0m Triage found 0 architectural hazards to convert into tasks. (All files compliant!)\n');
    }
    return tasks;
  }

  if (subCommand === 'inbox') {
    const agentId = flags.agent || flags.as || nonFlagPositional[0] || '@agent';
    const mailbox = getAgentMailbox(db, agentId, {
      since: flags.since,
      limit: flags.limit,
      markRead: flags.markRead
    });
    if (flags.isJson) {
      if (isCli) process.stdout.write(`${JSON.stringify(mailbox, null, 2)}\n`);
      return mailbox;
    }
    const card = formatMailboxCard(mailbox);
    if (isCli) process.stdout.write(card);
    return mailbox;
  }

  if (subCommand === 'dm') {
    const to = flags.to || nonFlagPositional[0];
    const msg = flags.to ? nonFlagPositional.join(' ') : nonFlagPositional.slice(1).join(' ');
    const hasRecipient = Boolean(to);
    const hasMsg = Boolean(msg);
    const canSend = hasRecipient && hasMsg;
    if (!canSend) {
      if (isCli) process.stderr.write('\x1b[31m✕ Usage: chemx team dm <@recipient> <message>\x1b[0m\n');
      return { error: 'Recipient and message required' };
    }
    const res = sendDirectMessage(db, {
      author_id: flags.as || '@agent',
      recipient_id: to,
      message: msg,
      task_id: flags.task || null,
      thread_id: flags.thread || null,
      metadata: flags.metadata || {}
    });
    if (isCli) {
      if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      else process.stdout.write(`\x1b[32m✔\x1b[0m Sent DM #${res.id} to ${res.recipient_id}\n`);
    }
    return res;
  }

  const isTrain = subCommand === 'train';
  if (isTrain) {
    return handleTrainCommand(db, nonFlagPositional[0] || 'status', flags, isCli, flags.isJson);
  }

  const isBenchmark = ['benchmark', 'ablation', 'memory'].includes(subCommand);
  if (isBenchmark) {
    const ablation = runAblationComparison(db);
    if (flags.isJson) {
      if (isCli) process.stdout.write(`${JSON.stringify(ablation, null, 2)}\n`);
      return ablation;
    }
    const card = formatAblationCard(ablation);
    if (isCli) process.stdout.write(card);
    return ablation;
  }

  if (isCli) {
    process.stderr.write(`\x1b[31m✕ Unknown team command: "${subCommand}". Available commands: status, task, feed, post, lock, unlock, triage, inbox, dm, benchmark\x1b[0m\n`);
  }
  return { error: `Unknown team command: ${subCommand}` };
};
