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
  const flags = { isJson: args.includes('--json'), isCompact: args.includes('--compact') };
  for (const arg of args) {
    if (arg.startsWith('--as=')) flags.as = arg.split('=')[1];
    if (arg.startsWith('--to=')) flags.to = arg.split('=')[1];
    if (arg.startsWith('--since=')) flags.since = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--thread=')) flags.thread = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--task=')) flags.task = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--type=')) flags.type = arg.split('=')[1];
    if (arg.startsWith('--status=')) flags.status = arg.split('=')[1];
    if (arg.startsWith('--agent=')) flags.agent = arg.split('=')[1];
    if (arg.startsWith('--target=')) flags.target = arg.split('=')[1];
    if (arg.startsWith('--tier=')) flags.tier = arg.split('=')[1];
    if (arg.startsWith('--prio=')) flags.priority = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--purpose=')) flags.purpose = arg.split('=')[1];
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
  const nonFlagPositional = restArgs.filter((a) => !a.startsWith('-'));

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
      const res = completeTaskWithAudit(db, taskId, agentHandle, { cwd });
      if (isCli) {
        if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        else process.stdout.write(`\x1b[32m✔\x1b[0m Completed task #${taskId}\n`);
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

    if (isCli) {
      process.stderr.write(`\x1b[31m✕ Unknown task action: "${taskAction}". Available actions: list, add, claim, done, triage\x1b[0m\n`);
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
