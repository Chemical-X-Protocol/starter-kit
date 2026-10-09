// Heavy synchronous actions (whole-tree AST audits) run in a worker thread, so the server keeps
// answering ping, progress and cancellation while they work. Cancellation terminates the worker.
import { isMainThread } from 'node:worker_threads';
import { currentRequestSignal } from '../request-context.js';
import { runWorker } from './worker-run.js';

const OFFLOADED_ACTIONS = new Set(['audit', 'patterns']);
const DEFAULT_OFFLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const WORKER_URL = new URL('./offload-worker.js', import.meta.url);

export const shouldOffload = (action, env = process.env) => OFFLOADED_ACTIONS.has(action) && isMainThread && env.CHEMX_MCP_NO_WORKERS !== '1';

export const runActionInWorker = async (action, params, cwd, { timeoutMs = DEFAULT_OFFLOAD_TIMEOUT_MS } = {}) => {
  const message = await runWorker(WORKER_URL, { action, params, cwd }, { label: action, timeoutMs, signal: currentRequestSignal() });
  const isFailure = Boolean(message.error);
  if (isFailure) throw new Error(message.error);
  return message.result;
};
