// Runs one worker-thread job: first message wins; error, early exit, timeout and abort all reject.
import { Worker } from 'node:worker_threads';
import { scheduleTimeout } from '../timers.js';

export const runWorker = (workerUrl, workerData, { label, timeoutMs, signal = null }) => new Promise((resolve, reject) => {
  const worker = new Worker(workerUrl, { workerData, stdout: true, stderr: true });
  worker.stdout.on('data', (chunk) => process.stderr.write(chunk));
  worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
  let isSettled = false;
  const settle = (fn, value) => {
    if (isSettled) return;
    isSettled = true;
    cancelTimeout();
    signal?.removeEventListener('abort', onAbort);
    worker.terminate();
    fn(value);
  };
  const onAbort = () => settle(reject, new Error(`${label} cancelled`));
  const cancelTimeout = scheduleTimeout(() => settle(reject, new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  worker.once('message', (message) => settle(resolve, message));
  worker.once('error', (err) => settle(reject, err));
  worker.once('exit', (code) => settle(reject, new Error(`${label} worker exited with code ${code} before replying`)));
});
