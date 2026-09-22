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
  requestFileLock,
  releaseFileLock,
  registerAgent
} from './team-db.js';
import { autoGenerateTasksFromAudit, completeTaskWithAudit, queryUnassignedHazards } from './team-triage.js';
import { formatSwarmStatusCard, formatFeedTimeline } from './team-format.js';

const parseFlags = (args = []) => {
  const flags = {
    isJson: args.includes('--json'),
    isCompact: args.includes('--compact'),
    force: args.includes('--force') || args.includes('-f'),
    noTargetConfirm: args.includes('--no-target-confirm')
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-target-confirm') flags.noTargetConfirm = true;
    if (arg.startsWith('--as=')) flags.as = arg.split('=')[1];
    if (arg === '--as' && args[i + 1] && !args[i + 1].startsWith('-')) flags.as = args[i + 1];
    if (arg.startsWith('--to=')) flags.to = arg.split('=')[1];
    if (arg === '--to' && args[i + 1] && !args[i + 1].startsWith('-')) flags.to = args[i + 1];
    if (arg.startsWith('--since=')) flags.since = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--thread=')) flags.thread = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--task=')) flags.task = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--type=')) flags.type = arg.split('=')[1];
    if (arg.startsWith('--status=')) flags.status = arg.split('=')[1];
    if (arg.startsWith('--agent=')) flags.agent = arg.split('=')[1];
    if (arg === '--agent' && args[i + 1] && !args[i + 1].startsWith('-')) flags.agent = args[i + 1];
    if (arg.startsWith('--target=')) flags.target = arg.split('=')[1];
    if (arg === '--target' && args[i + 1] && !args[i + 1].startsWith('-')) flags.target = args[i + 1];
    if (arg.startsWith('--tier=')) flags.tier = arg.split('=')[1];
    if (arg.startsWith('--prio=')) flags.priority = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--purpose=')) flags.purpose = arg.split('=')[1];
    if (arg.startsWith('--tokens=')) flags.tokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--prompt-tokens=')) flags.promptTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--completion-tokens=')) flags.completionTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--cached-tokens=')) flags.cachedTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--cost=')) flags.cost = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--model=')) flags.model = arg.split('=')[1];
    if (arg.startsWith('--metadata=')) {
      const raw = arg.slice('--metadata='.length);
      try {
        flags.metadata = JSON.parse(raw);
      } catch {
        flags.metadata = { raw };
      }
    }
  }
  return flags;
};

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
    if (i > 0 && ['--target', '--as', '--to', '--agent'].includes(restArgs[i - 1])) continue;
    nonFlagPositional.push(a);
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
    const taskAction = nonFlagPositional[0] || 'list';
    if (taskAction === 'list') {
      const tasks = listTasks(db, { status: flags.status, assigned_agent_id: flags.agent });
      if (flags.isJson) {
        const col = toColumnar(tasks, ['id', 'title', 'tier', 'status', 'priority', 'assigned_agent_id', 'target_path']);
        if (isCli) process.stdout.write(`${JSON.stringify(col, null, 2)}\n`);
        return col;
      }
      if (isCli) {
        if (tasks.length === 0) {
          process.stdout.write('  (No tasks found in backlog. Run "chemx team task triage" or "chemx team task add" to create tasks.)\n');
        } else {
          for (const t of tasks) {
            const assignee = t.assigned_agent_id ? `(${t.assigned_agent_id})` : '(unassigned)';
            const target = t.target_path ? ` [${t.target_path}]` : '';
            process.stdout.write(`  #${t.id} [${t.status}] ${assignee}${target}: ${t.title}\n`);
          }
        }
      }
      return tasks;
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
    if (taskAction === 'create' || taskAction === 'add' || taskAction === 'new') {
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
        assigned_agent_id: flags.agent || null
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
    if (taskAction === 'set-target' || taskAction === 'target') {
      const taskId = nonFlagPositional[1];
      const targetPath = flags.target || nonFlagPositional[2];
      if (!taskId || !targetPath) {
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
      process.stderr.write(`\x1b[31m✕ Unknown task action: "${taskAction}". Available actions: list, add, claim, done, triage, set-target\x1b[0m\n`);
    }
    return { error: `Unknown task action: ${taskAction}` };
  }

  if (subCommand === 'lock') {
    const file = nonFlagPositional[0];
    const res = requestFileLock(db, file, flags.as || '@agent', {
      purpose: flags.purpose,
      priority: flags.priority
    });
    if (isCli) {
      if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      else if (res.granted) process.stdout.write(`\x1b[32m✔\x1b[0m Acquired lock on ${file}\n`);
      else process.stdout.write(`\x1b[33m⏳\x1b[0m Enqueued in FIFO lock queue at position ${res.position} (held by ${res.currentHolder})\n`);
    }
    return res;
  }

  if (subCommand === 'unlock') {
    const file = nonFlagPositional[0];
    const res = releaseFileLock(db, file, flags.as || '@agent');
    if (isCli) {
      if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      else if (res.success) process.stdout.write(`\x1b[32m✔\x1b[0m Released lock on ${file}\n`);
      else process.stderr.write(`\x1b[31m✕ Unlock failed: ${res.reason}\x1b[0m\n`);
    }
    return res;
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

  if (isCli) {
    process.stderr.write(`\x1b[31m✕ Unknown team command: "${subCommand}". Available commands: status, task, feed, post, lock, unlock, triage\x1b[0m\n`);
  }
  return { error: `Unknown team command: ${subCommand}` };
};
