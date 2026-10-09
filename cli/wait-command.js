/**
 * chemx wait --task=<id> [--status=done] | --lock-free=<file> | --verify-idle  [--timeout=30m]
 * Polls every 3 seconds. Exit 0 when the condition holds, 2 on timeout, 1 on a usage error.
 * Guarantees: the condition was true at the moment of the last poll. Not guaranteed: it still holds
 * afterwards (another agent can lock the file or start a verify right after). --verify-idle looks at
 * the process table for chemx verify/test commands; on Linux it only counts ones whose working
 * directory is inside this project, elsewhere it counts every one it can see. A task id no db knows is
 * reported as unknown and keeps waiting until the timeout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { liveLeases, taskStatus } from './lease-view.js';

export const POLL_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export const WAIT_HELP = [
  'chemx wait --task=<id> [--status=done] | --lock-free=<file> | --verify-idle  [--timeout=30m]',
  '  --task=<id>        until the task reaches --status (default done)',
  '  --lock-free=<f>   until no unexpired lease exists on the file',
  '  --verify-idle      until no chemx verify/test process is running for this project',
  '  --timeout=<dur>    30s, 5m, 2h or plain seconds; default 30m',
  '  Polls every 3 seconds. Exit 0 = condition held at the last poll (it can change right after),',
  '  2 = timed out, 1 = bad arguments.'
].join('\n');

const UNITS = { s: 1000, m: 60000, h: 3600000 };

/** "30m" -> ms; a bare number is seconds; null when unparseable. */
export const parseDuration = (text) => {
  const match = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(String(text).trim());
  if (!match) return null;
  return Number(match[1]) * UNITS[match[2] || 's'];
};

const flagValue = (args, name) => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
};

export const parseWaitArgs = (args) => {
  const timeoutText = flagValue(args, 'timeout');
  const timeoutMs = timeoutText === undefined ? DEFAULT_TIMEOUT_MS : parseDuration(timeoutText);
  const task = flagValue(args, 'task');
  const lockFree = flagValue(args, 'lock-free');
  const verifyIdle = args.includes('--verify-idle');
  const modes = [task !== undefined, lockFree !== undefined, verifyIdle].filter(Boolean).length;
  const taskId = task === undefined ? null : Number(task);
  const isBadTask = task !== undefined && !Number.isInteger(taskId);
  const error = modes === 1 && timeoutMs !== null && !isBadTask ? null : 'give exactly one of --task=<id>, --lock-free=<file>, --verify-idle, and a valid --timeout and task id';
  return { error, timeoutMs, taskId, status: flagValue(args, 'status') || 'done', lockFree, verifyIdle };
};

const RUNNING = /(^|[\s/])(chemx|cli\/index\.js)\s+(verify|test|check:all)(\s|$)/;

const processCwd = (pid) => {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
};

const isInside = (dir, root) => dir === root || dir.startsWith(`${root}${path.sep}`);

/** Pure: process-table text ("pid args" lines) -> running verify/test processes for root. */
export const verifyProcesses = (psText, root, selfPid, cwdOf = processCwd) => psText.split('\n').map((line) => /^\s*(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
  .map((match) => ({ pid: Number(match[1]), args: match[2] }))
  .filter((proc) => proc.pid !== selfPid && RUNNING.test(proc.args))
  .filter((proc) => {
    const dir = cwdOf(proc.pid);
    return dir === null || isInside(dir, root);
  });

const readPs = () => {
  try {
    return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  } catch {
    return '';
  }
};

/** One poll: { done, note } for the requested condition. */
const checkTask = (opts, cwd) => {
  const status = taskStatus(cwd, opts.taskId);
  const isUnknown = status === null;
  const label = isUnknown ? 'unknown to any db' : status;
  return { done: status === opts.status, note: `task #${opts.taskId} is ${label}` };
};

const checkLock = (opts, cwd, now) => {
  const abs = path.resolve(cwd, opts.lockFree);
  const lease = liveLeases(cwd, now, [path.dirname(abs)]).find((item) => item.abs === abs);
  const note = lease ? `${opts.lockFree} held by ${lease.locked_by}` : `${opts.lockFree} has no live lease`;
  return { done: !lease, note };
};

const checkVerify = (cwd, env) => {
  const psText = env.ps === undefined ? readPs() : env.ps;
  const running = verifyProcesses(psText, cwd, process.pid);
  return { done: running.length === 0, note: `${running.length} verify/test process(es) running` };
};

export const checkOnce = (opts, cwd, env = {}) => {
  const now = env.now || Date.now();
  const waitsOnTask = opts.taskId !== null;
  const waitsOnLock = opts.lockFree !== undefined;
  const checks = [
    [waitsOnTask, () => checkTask(opts, cwd)],
    [waitsOnLock, () => checkLock(opts, cwd, now)]
  ];
  const match = checks.find(([applies]) => applies);
  return match ? match[1]() : checkVerify(cwd, env);
};

/**
 * @param {string[]} args
 * @param {{ cwd?: string, pollMs?: number, sleep?: Function, clock?: Function, env?: object, write?: Function }} [deps]
 * @returns {Promise<{ code: number, message: string }>}
 */
export const runWait = async (args, deps = {}) => {
  const { cwd = process.cwd(), pollMs = POLL_MS, sleep = sleepFor, clock = Date.now, env = {} } = deps;
  const wantsHelp = args.includes('--help') || args.includes('-h');
  if (wantsHelp) return { code: 0, message: WAIT_HELP };
  const opts = parseWaitArgs(args);
  const isUsageError = Boolean(opts.error);
  if (isUsageError) return { code: 1, message: `chemx wait: ${opts.error}\n${WAIT_HELP}` };
  const started = clock();
  while (true) {
    const result = checkOnce(opts, cwd, env);
    const elapsed = clock() - started;
    const seconds = (elapsed / 1000).toFixed(1);
    const isMet = result.done;
    if (isMet) return { code: 0, message: `condition met after ${seconds}s: ${result.note}` };
    const isOut = elapsed + pollMs > opts.timeoutMs;
    if (isOut) return { code: 2, message: `timed out after ${seconds}s (limit ${opts.timeoutMs / 1000}s): ${result.note}` };
    await sleep(pollMs);
  }
};

export const runWaitCli = async (args, cwd = process.cwd()) => {
  const result = await runWait(args, { cwd });
  process.stdout.write(`${result.message}\n`);
  return result.code;
};
