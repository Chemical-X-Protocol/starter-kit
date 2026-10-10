// Runs a planned test command inside the shared cross-process worker budget: take slots, tell
// the runner how many workers it got, run, give the slots back.
import { executeBuild } from './build/executor.js';
import { currentRequestSignal } from './request-context.js';
import { acquireTestSlots, resolveTestBudget, SLOT_OWNER_ENV } from './test-slots.js';
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

// options.env replaces process.env for budget resolution and is added to the runner's env.
// options.waitTimeoutMs / returnQueuedAfterMs / retryCommand / task go to acquireTestSlots.
// Resolves to { execution, command, workers, budget, queuedMs }, or, when returnQueuedAfterMs
// elapsed with no free slot, { queued: true, position, holders, retryCommand, workers: 0, budget, queuedMs }
// with nothing run or held. A wait timeout rejects with code SLOT_WAIT_TIMEOUT_CODE.
export const runWithinBudget = async (plan, options = {}) => {
  const env = options.env || process.env;
  const budget = resolveTestBudget(env);
  const want = requestedWorkers({ command: plan.command, cwd: plan.cwd, targets: plan.targets || [], budget });
  const signal = options.signal ?? currentRequestSignal();
  const handle = env.CHEMX_AGENT_ID ?? null;
  const onLongWait = options.onLongWait ?? ((info) => { void postLongWait(info, plan.cwd, handle); });
  const grant = await acquireTestSlots({
    env, budget, want, onWait: options.onWait, signal, onLongWait,
    task: options.task, waitTimeoutMs: options.waitTimeoutMs,
    returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand
  });
  const isQueued = grant.queued === true;
  if (isQueued) return grant;
  const command = withWorkerCount(plan.command, plan.runner, grant.workers, { forwardsArgs: plan.forwardsArgs });
  try {
    // NODE_TEST_CONTEXT would make a nested `node --test` report to a parent that is not listening.
    const { NODE_TEST_CONTEXT, ...extraEnv } = options.env || {};
    const childEnv = { ...extraEnv, [SLOT_OWNER_ENV]: String(process.pid) };
    const execution = await executeBuild(command, plan.cwd, { raw: options.raw, timeoutMs: options.timeoutMs, env: childEnv, signal });
    return { execution, command, workers: grant.workers, budget, queuedMs: grant.queuedMs };
  } finally {
    grant.release();
  }
};
