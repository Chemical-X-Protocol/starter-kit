// Runs a planned test command inside the shared cross-process worker budget: take slots, tell
// the runner how many workers it got, run, give the slots back.
import { executeBuild } from './build/executor.js';
import { currentRequestSignal } from './request-context.js';
import { acquireTestSlots, resolveTestBudget, SLOT_OWNER_ENV } from './test-slots.js';
import { withWorkerCount, requestedWorkers } from './test-workers.js';

// options.env replaces process.env for budget resolution and is added to the runner's env.
// Resolves to { execution, command, workers, budget, queuedMs }.
export const runWithinBudget = async (plan, options = {}) => {
  const env = options.env || process.env;
  const budget = resolveTestBudget(env);
  const want = requestedWorkers({ command: plan.command, cwd: plan.cwd, targets: plan.targets || [], budget });
  const signal = options.signal ?? currentRequestSignal();
  const grant = await acquireTestSlots({ env, budget, want, onWait: options.onWait, signal });
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
