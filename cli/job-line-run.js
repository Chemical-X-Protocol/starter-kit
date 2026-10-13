// How the callers of heavy work (a full test run, a typecheck, a build) take their turn in the line
// (job line spec 2026-10-13, section 4): the job key, the wait limit, the output a joiner replays,
// and the shared-run fields of a result. The line itself lives in job-line.js.
import { runHeavy, jobKey } from './job-line.js';
import { listTestSlots, SLOT_WAIT_TIMEOUT_CODE } from './test-slots.js';
import { resolveTestBudget } from './slot-files.js';
import { currentRequestSignal } from './request-context.js';
import { scheduleTimeout } from './timers.js';

// The options of a caller that go to the line as they are: the env that names the slot dir and the
// budget, what the job is, how it reports waiting, and the clocks specs speed up.
const LINE_OPTION_KEYS = ['env', 'task', 'onWait', 'onWarn', 'pollMs', 'heartbeatMs', 'staleMs', 'statusMs'];

export const lineOptionsOf = (options = {}) => {
  const isGiven = (key) => options[key] !== undefined;
  return Object.fromEntries(LINE_OPTION_KEYS.filter(isGiven).map((key) => [key, options[key]]));
};

// An explicit --wait-timeout: stop waiting for a turn after `ms`. The abort reaches the wait only; a
// job that has started is never cut short: the limit stops when the run starts, for a joiner when the
// run it joined starts (runHeavy's onStart), and again as the first thing an owner's run does.
const waitLimitOf = (ms, outerSignal) => {
  const controller = new AbortController();
  let hasExpired = false;
  const hasLimit = Number(ms) > 0;
  const stop = hasLimit ? scheduleTimeout(() => { hasExpired = true; controller.abort(); }, Number(ms), { unref: true }) : () => {};
  const signal = outerSignal ? AbortSignal.any([outerSignal, controller.signal]) : controller.signal;
  return { signal, stop, hasExpired: () => hasExpired };
};

const queueTimeoutError = (waitedMs, holders) => {
  const names = [...new Set(holders.map((holder) => holder.handle || `pid ${holder.pid}`))];
  const who = names.join(', ') || 'the heavy line';
  return Object.assign(new Error(`chemx: queued too long (${Math.round(waitedMs / 1000)}s), held by ${who}`), { code: SLOT_WAIT_TIMEOUT_CODE });
};

// Who holds slots right now, one row per heavy job (it holds several slots) and one per light slot.
const liveHolders = (budget, lineOptions) => {
  const { holders } = listTestSlots({ env: lineOptions.env, budget, staleMs: lineOptions.staleMs });
  const seen = new Set();
  const isFirstRowOfHolder = (holder) => {
    const id = holder.seq ?? `slot-${holder.slot}`;
    const isWanted = holder.state === 'held' && !seen.has(id);
    if (isWanted) seen.add(id);
    return isWanted;
  };
  return holders.filter(isFirstRowOfHolder);
};

// A run its own caller cancelled is nobody's result: throwing makes runHeavy write none, so callers
// who joined it take the ticket over and run it themselves.
const cancelledRun = (execution) => Object.assign(new Error('chemx: run cancelled'), { cancelledExecution: execution });

const replayOutput = ({ stdout, stderr }) => {
  const hasStdout = stdout.length > 0;
  const hasStderr = stderr.length > 0;
  if (hasStdout) process.stdout.write(stdout);
  if (hasStderr) process.stderr.write(stderr);
};

/**
 * Runs `execute(workers)` as a heavy job of `kind` in `cwd` and resolves to
 * { execution, workers, budget, queuedMs, shared } (`shared` is null for an unshared run, else
 * { owner, joined, seq }), or to runHeavy's queued outcome plus `holders` (the live slot holders) when
 * returnQueuedAfterMs passes first. `keyCommand` is the command callers who share a run have in common.
 * A caller that joined a run (it executed nothing) prints that run's stored output when `raw` is set.
 * `waitTimeoutMs` rejects with SLOT_WAIT_TIMEOUT_CODE when no turn came in time; with none, a heavy
 * job waits as long as it takes. The rest of the options go to runHeavy (see job-line.js).
 */
export const runInLine = async ({ kind, cwd, keyCommand, raw = false, waitTimeoutMs, ...lineOptions }, execute) => {
  const start = Date.now();
  const budget = lineOptions.budget ?? resolveTestBudget(lineOptions.env || process.env);
  const limit = waitLimitOf(waitTimeoutMs, lineOptions.signal ?? currentRequestSignal());
  let granted = null;
  const run = async (workers) => {
    granted = workers;
    limit.stop();
    const execution = await execute(workers);
    const isCancelled = Boolean(execution.cancelled);
    if (isCancelled) throw cancelledRun(execution);
    return execution;
  };
  try {
    const outcome = await runHeavy({ kind, key: jobKey({ kind, cwd, command: keyCommand }), ...lineOptions, budget, signal: limit.signal, onStart: limit.stop }, run);
    const isQueued = outcome.queued === true;
    if (isQueued) return { ...outcome, holders: liveHolders(budget, lineOptions) };
    const isJoined = granted === null;
    const shouldReplay = raw && isJoined;
    if (shouldReplay) replayOutput(outcome.result);
    return { execution: outcome.result, workers: outcome.workers, budget: outcome.budget, queuedMs: outcome.queuedMs, shared: outcome.shared };
  } catch (error) {
    const wasCancelled = Boolean(error?.cancelledExecution);
    if (wasCancelled) return { execution: error.cancelledExecution, workers: granted, budget, queuedMs: Date.now() - start, shared: null };
    if (limit.hasExpired()) throw queueTimeoutError(Date.now() - start, liveHolders(budget, lineOptions));
    throw error;
  } finally {
    limit.stop();
  }
};
