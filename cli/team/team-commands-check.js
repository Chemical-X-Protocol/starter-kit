/**
 * `chemx team check <typecheck|test|verify|build>`: enqueue a heavy check and return at once; the
 * detached drain worker runs it and the result arrives as a DM (and a board post on a fault).
 * Also `check status | list | show <id> | cancel <id> | drain`. Phase 1: reached only by this
 * command; nothing else routes into the queue.
 */

import { resolveAgentId } from './agent-identity.js';
import { CHECK_KINDS, cancelCheck, countByStatus, enqueueCheck, getCheck, listChecks, treeFingerprint } from './check-queue.js';
import { IDLE_EXIT_MS, drainerStatus, ensureDrainer, runDrainer } from './check-drainer.js';
import { createCheckExecutor } from './check-executor.js';
import { deliverCheckResult } from './check-delivery.js';

const USAGE = `Usage: chemx team check <${CHECK_KINDS.join('|')}> [--task=<id>] [--json]
       chemx team check status | list [--limit=<n>] | show <id> | cancel <id> | drain [--once] [--idle-exit-s=<n>]`;

const valueOf = (restArgs, name) => {
  const hit = restArgs.find((word) => word.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const out = (isCli, isJson, data, text) => {
  if (isCli) process.stdout.write(isJson ? `${JSON.stringify(data)}\n` : `${text}\n`);
  return data;
};

const fail = (isCli, message) => {
  if (isCli) {
    process.stderr.write(`\x1b[31m✕ ${message}\x1b[0m\n`);
    process.exitCode = 1;
  }
  return { error: message, refused: true };
};

const ago = (ms) => (ms == null ? '' : `${Math.round((Date.now() - ms) / 1000)}s ago`);

const describeEnqueue = (kind, queued) => {
  const isCached = queued.action === 'cached';
  if (isCached) return `${kind} passed at this exact tree ${ago(queued.job.finished_at)} (check #${queued.id}); nothing queued.`;
  const verb = queued.action === 'queued' ? 'queued' : 'already queued';
  const extra = queued.action === 'joined' ? ' (a run at this tree is already running; you will get its result)' : '';
  return `${kind} ${verb} as check #${queued.id} (position ${queued.position}); keep working; faults will be posted to the board and you will be DMed.${extra}`;
};

const enqueue = (ctx, kind, args, cwd, deps) => {
  const { flags } = args;
  const requester = resolveAgentId(flags.as);
  const fingerprint = (deps.fingerprint || treeFingerprint)(cwd);
  const queued = enqueueCheck(ctx.db, { kind, cwd, requester, taskId: flags.task || null, fingerprint, now: deps.now?.() });
  const isNewWork = queued.action === 'queued';
  if (isNewWork) (deps.ensure || ensureDrainer)(ctx.db, { cwd });
  return queued;
};

const showText = (job) => {
  const who = job.requesters.map((r) => r.agent_id).join(', ');
  const faults = (job.result.faults || []).map((f) => `  ${f.file}${f.line ? `:${f.line}` : ''} ${f.code || ''} ${f.message || ''}`.trimEnd());
  return [`check #${job.id} ${job.kind} [${job.status}] requested by ${who}`, job.result.summaryLine || '', ...faults].filter(Boolean).join('\n');
};

const listText = (jobs) => (jobs.length ? jobs.map((j) => `#${j.id} ${j.kind} ${j.status} ${j.result.status || ''} ${ago(j.created_at)}`.replace(/ +/g, ' ').trim()).join('\n') : 'No checks queued yet.');

const statusText = (counts, drainer) => {
  const pending = `${counts.queued || 0} queued, ${counts.running || 0} running, ${counts.done || 0} done, ${counts.failed || 0} failed`;
  const worker = drainer.running ? `drain worker pid ${drainer.pid} (heartbeat ${Math.round(drainer.heartbeatAgeMs / 1000)}s ago)` : 'no drain worker running (it starts on the next enqueue)';
  return `${pending}\n${worker}`;
};

const subCommands = {
  status: (ctx, args, isCli) => {
    const data = { counts: countByStatus(ctx.db), drainer: drainerStatus(ctx.db) };
    return out(isCli, args.flags.isJson, data, statusText(data.counts, data.drainer));
  },
  list: (ctx, args, isCli) => {
    const jobs = listChecks(ctx.db, { limit: args.flags.limit || 20 });
    return out(isCli, args.flags.isJson, { jobs }, listText(jobs));
  },
  show: (ctx, args, isCli) => {
    const job = getCheck(ctx.db, Number(args.positionals[1]));
    if (!job) return fail(isCli, `No check #${args.positionals[1]}. Usage: chemx team check show <id>`);
    return out(isCli, args.flags.isJson, job, showText(job));
  },
  cancel: (ctx, args, isCli) => {
    const id = Number(args.positionals[1]);
    const result = cancelCheck(ctx.db, id);
    if (!result.ok) return fail(isCli, result.reason);
    return out(isCli, args.flags.isJson, { cancelled: id, ...result }, `check #${id} cancelled${result.wasRunning ? ' (it was running; its result will be discarded)' : ''}.`);
  },
  drain: (ctx, args, isCli, cwd, deps) => {
    const idleSeconds = Number(valueOf(args.restArgs, 'idle-exit-s'));
    const idleExitMs = idleSeconds > 0 ? idleSeconds * 1000 : IDLE_EXIT_MS;
    const executor = deps.executor || createCheckExecutor();
    return runDrainer(ctx.db, { executor, deliver: deps.deliver || deliverCheckResult, idleExitMs, once: args.restArgs.includes('--once'), ...deps.drainer });
  }
};

/** Returns the result object, or a promise of one for `drain`. */
export const handleCheckCommand = (ctx, args, isCli, cwd, deps = {}) => {
  const sub = args.positionals[0];
  const isKind = CHECK_KINDS.includes(sub);
  if (isKind) {
    const queued = enqueue(ctx, sub, args, cwd, deps);
    return out(isCli, args.flags.isJson, { kind: sub, action: queued.action, id: queued.id, position: queued.position }, describeEnqueue(sub, queued));
  }
  const handler = Object.hasOwn(subCommands, sub || '') ? subCommands[sub] : null;
  if (!handler) return fail(isCli, `${sub ? `Unknown check command "${sub}".` : 'Missing check kind.'}\n${USAGE}`);
  return handler(ctx, args, isCli, cwd, deps);
};
