// Heavy synchronous actions (whole-tree AST audits) run in a worker thread, so the server keeps
// answering ping, progress and cancellation while they work. Cancellation terminates the worker.
import { Worker, isMainThread } from 'node:worker_threads';
import { currentRequestSignal } from '../request-context.js';
import { scheduleTimeout } from '../timers.js';

const OFFLOADED_ACTIONS = new Set(['audit', 'patterns']);
const DEFAULT_OFFLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const WORKER_URL = new URL('./offload-worker.js', import.meta.url);

export const shouldOffload = (action, env = process.env) => OFFLOADED_ACTIONS.has(action) && isMainThread && env.CHEMX_MCP_NO_WORKERS !== '1';

export const runActionInWorker = (action, params, cwd, { timeoutMs = DEFAULT_OFFLOAD_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
  const signal = currentRequestSignal();
  const worker = new Worker(WORKER_URL, { workerData: { action, params, cwd }, stdout: true, stderr: true });
  worker.stdout.on('data', (chunk) => process.stderr.write(chunk));
  worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const settle = (fn, value) => {
    cancelTimeout();
    signal?.removeEventListener('abort', onAbort);
    worker.terminate();
    fn(value);
  };
  const onAbort = () => settle(reject, new Error(`${action} cancelled`));
  const cancelTimeout = scheduleTimeout(() => settle(reject, new Error(`${action} timed out after ${timeoutMs} ms`)), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  worker.once('message', (message) => {
    const isFailure = Boolean(message.error);
    if (isFailure) settle(reject, new Error(message.error));
    else settle(resolve, message.result);
  });
  worker.once('error', (err) => settle(reject, err));
});
