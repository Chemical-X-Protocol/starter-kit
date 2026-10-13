// Runs a planned test command inside the shared cross-process worker budget, in one of two lanes.
// A run whose caller named targets is light: take free slots at once, tell the runner how many
// workers it got, run, give the slots back. Anything else is the full suite (or a test lane's whole
// spec list) and heavy: it waits its turn in the line (job-line.js), shares one run with callers
// asking for the same thing, and tells the runner the heavy worker count.
import { executeBuild } from './build/executor.js';
import { currentRequestSignal } from './request-context.js';
import { acquireTestSlots, resolveTestBudget, SLOT_OWNER_ENV } from './test-slots.js';
import { resolveLanes } from './job-line.js';
import { runInLine, lineOptionsOf } from './job-line-run.js';
import { withWorkerCount, requestedWorkers } from './test-workers.js';

// Best effort: a run that waited 60s+ for a slot leaves a feed event, so load shows in triage.
// Never throws; the event is skipped when no coordination db resolves.
const postLongWait = async ({ queuedMs, budget, holders }, cwd, handle) => {
  try {
    const { openCommitDb } = await import('./commit/commit-record.js');
    const { postFeedEvent } = await import('./team/team-db.js');
    const db = openCommitDb(cwd);
    const hasDb = Boolean(db);
    if (!hasDb) return;
    const who = holders.map((holder) => holder.handle || `pid ${holder.pid}`).join(', ') || 'unknown';
    postFeedEvent(db, { author_id: handle || '@system', event_type: 'test-queue', message: `chemx test waited ${Math.round(queuedMs / 1000)}s for a test slot (budget ${budget}, held by ${who})`, metadata: { queuedMs, budget, holders } });
  } catch {
    // chemx-allow: best-effort the feed event is a courtesy and must never fail a test run
  }
};

// The runner's env: the caller's, minus NODE_TEST_CONTEXT (a nested `node --test` would report to a
// parent that is not listening), stamped as running inside this process's slots.
const runnerEnv = (options) => {
  const { NODE_TEST_CONTEXT, ...extraEnv } = options.env || {};
  return { ...extraEnv, [SLOT_OWNER_ENV]: String(process.pid) };
};

const runLight = async (plan, options, { env, budget, signal }) => {
  const want = requestedWorkers({ command: plan.command, cwd: plan.cwd, targets: plan.targets, budget });
  const handle = env.CHEMX_AGENT_ID ?? null;
  const onLongWait = options.onLongWait ?? ((info) => { void postLongWait(info, plan.cwd, handle); });
  const grant = await acquireTestSlots({
    env, budget, want, onWait: options.onWait, signal, onLongWait,
    task: options.task, waitTimeoutMs: options.waitTimeoutMs,
    returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand
  });
  const isQueued = grant.queued === true;
  if (isQueued) return grant;
  const command = withWorkerCount(plan.command, plan.runner, grant.workers, { forwardsArgs: plan.forwardsArgs, cwd: plan.cwd });
  try {
    const execution = await executeBuild(command, plan.cwd, { raw: options.raw, timeoutMs: options.timeoutMs, env: runnerEnv(options), signal });
    return { execution, command, workers: grant.workers, budget, queuedMs: grant.queuedMs, shared: null };
  } finally {
    grant.release();
  }
};

// The full suite. The line grants the heavy workers; a script that caps its own --test-concurrency
// still caps the runner. The key's command is the one fitted to the heavy count, so two callers
// asking for the same suite share a run.
const runFullSuite = async (plan, options, { env, budget, signal }) => {
  const { heavy } = resolveLanes(env, budget);
  const cap = requestedWorkers({ command: plan.command, cwd: plan.cwd, targets: plan.targets || [], budget: heavy });
  const fitted = (granted) => withWorkerCount(plan.command, plan.runner, Math.min(granted, cap), { forwardsArgs: plan.forwardsArgs, cwd: plan.cwd });
  const line = {
    kind: 'tests', cwd: plan.cwd, keyCommand: fitted(heavy), raw: options.raw, waitTimeoutMs: options.waitTimeoutMs, budget, signal,
    returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand, ...lineOptionsOf(options)
  };
  const outcome = await runInLine(line, (granted) => executeBuild(fitted(granted), plan.cwd, { raw: options.raw, timeoutMs: options.timeoutMs, env: runnerEnv(options), signal }));
  const isQueued = outcome.queued === true;
  if (isQueued) return outcome;
  return { execution: outcome.execution, command: fitted(outcome.workers), workers: outcome.workers, budget, queuedMs: outcome.queuedMs, shared: outcome.shared };
};

// options.heavy says which lane the caller's request belongs to (runTestAudit decides it before test
// lanes turn an empty scope into a spec list); without it, a plan with no targets is the full suite.
// options.env replaces process.env for budget resolution and is added to the runner's env.
// options.waitTimeoutMs / returnQueuedAfterMs / retryCommand / task go to the lane that waits (a light
// run's default wait limit is 10 minutes; a full suite waits without one unless waitTimeoutMs is given).
// Resolves to { execution, command, workers, budget, queuedMs, shared } where `shared` is null for an
// unshared run, else { owner, joined, seq }; or, when returnQueuedAfterMs elapsed with no turn,
// { queued: true, position, holders, retryCommand, workers: 0, budget, queuedMs } with nothing run or
// held. A wait timeout rejects with code SLOT_WAIT_TIMEOUT_CODE.
export const runWithinBudget = async (plan, options = {}) => {
  const env = options.env || process.env;
  const budget = resolveTestBudget(env);
  const signal = options.signal ?? currentRequestSignal();
  const isFullSuite = options.heavy ?? (plan.targets || []).length === 0;
  const lane = { env, budget, signal };
  return isFullSuite ? runFullSuite(plan, options, lane) : runLight(plan, options, lane);
};
