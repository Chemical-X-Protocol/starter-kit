/**
 * `chemx team check <typecheck|test|verify|build>`: enqueue a heavy check and return at once; the
 * detached drain worker runs it and the result arrives as a DM (and a board post on a fault).
 * Also `check status | list | show <id> | cancel <id> | drain`. Phase 1: reached only by this
 * command; nothing else routes into the queue.
 */

import { isStableIdentity, resolveAgentIdentity } from './agent-identity.js';
import { CHECK_KINDS, cancelCheck, countByStatus, enqueueCheck, getCheck, listChecks } from './check-queue.js';
import { treeFingerprint } from './check-fingerprint.js';
import { IDLE_EXIT_MS, drainLogPath, drainerStatus, ensureDrainer, runDrainer } from './check-drainer.js';
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

const describeEnqueue = (kind, queued, workerError) => {
  const isCached = queued.action === 'cached';
  if (isCached) return `${kind} passed at this exact tree ${ago(queued.job.finished_at)} (check #${queued.id}); nothing queued.`;
  const verb = queued.action === 'queued' ? 'queued' : 'already queued';
  const extra = queued.action === 'joined' ? ' (a run at this tree is already running; you will get its result)' : '';
  const warning = workerError ? `\nWARNING: the drain worker could not be started (${workerError}); nothing will run until you start it: chemx team check drain` : '';
  return `${kind} ${verb} as check #${queued.id} (position ${queued.position}); keep working; faults will be posted to the board and you will be DMed.${extra}${warning}`;
};

const unstableIdentityMessage = (identity) => `Check results are delivered by DM to the requester, and ${identity.id} is ${identity.source === 'process' ? 'unique to this process' : 'not a stable handle'}: nobody would ever read it. Pass --as=<@handle> or set CHEMX_AGENT_ID, then rerun chemx team check.`;

// The shallow fingerprint is the only tree-wide work on the enqueue path; the deep one (submodule working trees) runs only
// when a cache or join candidate must be verified. Specs inject `fingerprint` and vouch for it as complete.
const fingerprintsOf = (cwd, deps) => {
  const shallow = (deps.fingerprint || treeFingerprint)(cwd);
  const deep = deps.deepFingerprint ?? (deps.fingerprint ? null : () => treeFingerprint(cwd, { deep: true }));
  return { shallow, deep };
};

/** Returns { queued, workerError }, or { refused: message } when the requester is not a stable handle. */
const enqueue = (ctx, kind, args, cwd, deps) => {
  const { flags } = args;
  const identity = resolveAgentIdentity(flags.as);
  if (!isStableIdentity(identity)) return { refused: unstableIdentityMessage(identity) };
  const { shallow, deep } = fingerprintsOf(cwd, deps);
  const queued = enqueueCheck(ctx.db, { kind, cwd, requester: identity.id, taskId: flags.task || null, fingerprint: shallow, deepFingerprint: deep, now: deps.now?.() });
  // Every outcome but a cache hit leaves work nobody may be doing (a coalesced or joined job can sit behind a dead worker).
  const needsWorker = queued.action !== 'cached';
  const started = needsWorker ? (deps.ensure || ensureDrainer)(ctx.db, { cwd }) : null;
  return { queued, workerError: started?.error || null };
};

/** Tells a cancelled job's requesters (all but the canceller). Never throws: a failed DM stays un-notified and the worker's sweep retries it. */
const tellRequesters = (db, job, by, deps) => {
  const deliver = deps.deliver || deliverCheckResult;
  if (by) db.prepare('UPDATE check_requesters SET notified_at = ? WHERE job_id = ? AND agent_id = ? AND notified_at IS NULL').run(Date.now(), job.id, by);
  try {
    const outcome = deliver(db, job, job.result);
    return { dms: outcome?.dms ?? 0, errors: outcome?.errors ?? [] };
  } catch (error) {
    return { dms: 0, errors: [String(error?.message || error)] };
  }
};

const showText = (job) => {
  const who = job.requesters.map((r) => r.agent_id).join(', ');
  const faults = (job.result.faults || []).map((f) => `  ${f.file}${f.line ? `:${f.line}` : ''} ${f.code || ''} ${f.message || ''}`.trimEnd());
  return [`check #${job.id} ${job.kind} [${job.status}] requested by ${who}`, job.result.summaryLine || '', ...faults].filter(Boolean).join('\n');
};

const listText = (jobs) => (jobs.length ? jobs.map((j) => `#${j.id} ${j.kind} ${j.status} ${j.result.status || ''} ${ago(j.created_at)}`.replace(/ +/g, ' ').trim()).join('\n') : 'No checks queued yet.');

const statusText = (counts, drainer) => {
  const pending = `${counts.queued || 0} queued, ${counts.running || 0} running, ${counts.done || 0} done, ${counts.failed || 0} failed`;
  const worker = drainer.running ? `drain worker pid ${drainer.pid} (heartbeat ${Math.round(drainer.heartbeatAgeMs / 1000)}s ago)` : `no drain worker running (it starts on the next enqueue; its log: ${drainLogPath()})`;
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
  cancel: (ctx, args, isCli, cwd, deps) => {
    const id = Number(args.positionals[1]);
    const identity = resolveAgentIdentity(args.flags.as);
    const by = isStableIdentity(identity) ? identity.id : null;
    const { job, ...result } = cancelCheck(ctx.db, id, { by });
    if (!result.ok) return fail(isCli, result.reason);
    const told = tellRequesters(ctx.db, job, by, deps);
    const running = result.wasRunning ? ' (it was running; its worker stops it within about a second)' : '';
    const failed = told.errors.length ? `, ${told.errors.length} DM(s) failed and the worker will retry them` : '';
    return out(isCli, args.flags.isJson, { cancelled: id, wasRunning: result.wasRunning, notified: told.dms, notifyErrors: told.errors }, `check #${id} cancelled${running}; ${told.dms} other requester(s) told${failed}.`);
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
    const { queued, workerError, refused } = enqueue(ctx, sub, args, cwd, deps);
    if (refused) return fail(isCli, refused);
    const data = { kind: sub, action: queued.action, id: queued.id, position: queued.position, ...(workerError ? { workerError } : {}) };
    return out(isCli, args.flags.isJson, data, describeEnqueue(sub, queued, workerError));
  }
  const handler = Object.hasOwn(subCommands, sub || '') ? subCommands[sub] : null;
  if (!handler) return fail(isCli, `${sub ? `Unknown check command "${sub}".` : 'Missing check kind.'}\n${USAGE}`);
  return handler(ctx, args, isCli, cwd, deps);
};
