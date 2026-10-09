import { spawn } from 'node:child_process';
import { isStdoutTty } from '../terminal.js';
import { currentRequestSignal } from '../request-context.js';
import { scheduleTimeout } from '../timers.js';
import { canSignalGroups, killTree, trackChild, untrackChild } from './child-registry.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const KILL_GRACE_MS = 2000;
export const CANCEL_EXIT_CODE = 130;

// An explicit timeout wins; otherwise CHEMX_CHILD_TIMEOUT_MS, otherwise 15 minutes.
export const resolveChildTimeoutMs = (options = {}, env = process.env) => {
  const fromEnv = Number(env.CHEMX_CHILD_TIMEOUT_MS);
  const hasEnvTimeout = Number.isFinite(fromEnv) && fromEnv > 0;
  return options.timeoutMs ?? (hasEnvTimeout ? fromEnv : DEFAULT_TIMEOUT_MS);
};

// Color only when the child streams straight to a human terminal; captured output is parsed.
const colorEnv = (isRawStream) => {
  const isColorWanted = isRawStream && isStdoutTty() && !process.env.NO_COLOR;
  return isColorWanted ? { FORCE_COLOR: '1' } : { NO_COLOR: '1', FORCE_COLOR: '0' };
};

// A child must not inherit node:test's harness context, or a nested `node --test` reports
// to a parent that is not listening and prints no TAP summary at all.
const childEnv = (isRawStream, extraEnv = {}) => {
  const { NODE_TEST_CONTEXT, ...parentEnv } = process.env;
  return { ...parentEnv, ...colorEnv(isRawStream), ...extraEnv };
};

// Runs a shell command with stdin closed (no runner can enter watch mode, wait on a prompt or
// read the MCP JSON-RPC stream), a timeout, and cancellation through options.signal or the
// current request context. The child gets its own process group (tracked by child-registry,
// which forwards signals to it), so a timeout kills `npm run x` and everything it started.
// Result: { exitCode, stdout, stderr, durationMs, command, timedOut, cancelled }. A timed-out
// run reports exitCode null so callers cannot mistake it for a verdict.
export const executeBuild = (command, cwd = process.cwd(), options = {}) => new Promise((resolve) => {
  const startTime = Date.now();
  const isRawStream = Boolean(options.raw);
  const timeoutMs = resolveChildTimeoutMs(options);
  const signal = options.signal ?? currentRequestSignal();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stopReason = null;
  let isSettled = false;

  const child = spawn(command, { shell: true, cwd, detached: canSignalGroups, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(isRawStream, options.env) });
  trackChild(child);

  const stop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    const isTimeout = reason === 'timeout';
    stderrBuffer += isTimeout ? `\nTimed out after ${timeoutMs}ms: ${command}\n` : '\nchemx: command cancelled; process tree killed.\n';
    killTree(child, 'SIGTERM');
    scheduleTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS, { unref: true });
  };
  const cancelTimeout = scheduleTimeout(() => stop('timeout'), timeoutMs);
  const onAbort = () => stop('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdoutBuffer += text;
    if (isRawStream) process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    if (isRawStream) process.stderr.write(text);
  });

  const finish = (code) => {
    if (isSettled) return;
    isSettled = true;
    cancelTimeout();
    signal?.removeEventListener('abort', onAbort);
    untrackChild(child);
    const isTimedOut = stopReason === 'timeout';
    const isCancelled = stopReason === 'cancelled';
    const stoppedCode = isTimedOut ? null : CANCEL_EXIT_CODE;
    resolve({
      exitCode: stopReason ? stoppedCode : code,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      durationMs: Date.now() - startTime,
      command,
      timedOut: isTimedOut,
      cancelled: isCancelled
    });
  };
  child.on('error', (err) => {
    stderrBuffer += `\nProcess error: ${err.message}\n`;
    finish(1);
  });
  child.on('close', (code, closeSignal) => {
    const wasSignalled = code === null;
    const hasSignalName = wasSignalled && Boolean(closeSignal) && !stopReason;
    if (hasSignalName) stderrBuffer += `\nProcess killed by ${closeSignal}\n`;
    finish(wasSignalled ? 1 : code);
  });
});
