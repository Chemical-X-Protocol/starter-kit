import { spawn } from 'node:child_process';
import { isInteractive, isStdoutTty } from '../terminal.js';
import { currentRequestSignal } from '../request-context.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const KILL_GRACE_MS = 2000;
export const TIMEOUT_EXIT_CODE = 124;
export const CANCEL_EXIT_CODE = 130;

export const resolveChildTimeoutMs = (options = {}, env = process.env) => {
  const fromEnv = Number(env.CHEMX_CHILD_TIMEOUT_MS);
  const hasEnvTimeout = Number.isFinite(fromEnv) && fromEnv > 0;
  return options.timeoutMs ?? (hasEnvTimeout ? fromEnv : DEFAULT_TIMEOUT_MS);
};

const colorEnv = () => {
  const isColorWanted = isStdoutTty() && !process.env.NO_COLOR;
  return isColorWanted ? { FORCE_COLOR: '1' } : { NO_COLOR: '1', FORCE_COLOR: '0' };
};

// Kill the whole process group when we own one, so shells cannot orphan their children.
const killTree = (child, ownsGroup, signal) => {
  try {
    if (ownsGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (err) {
    if (err.code !== 'ESRCH') process.stderr.write(`[executor] kill ${signal} failed: ${err.message}\n`);
  }
};

// Runs a shell command with stdin closed (it must never read the MCP JSON-RPC stream),
// a timeout, and cancellation through options.signal or the current request context.
export const executeBuild = (command, cwd = process.cwd(), options = {}) => new Promise((resolve) => {
  const startTime = Date.now();
  const isRawStream = Boolean(options.raw);
  const timeoutMs = resolveChildTimeoutMs(options);
  const signal = options.signal ?? currentRequestSignal();
  const ownsGroup = process.platform !== 'win32' && !isInteractive();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stopReason = null;

  const child = spawn(command, { shell: true, cwd, detached: ownsGroup, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...colorEnv() } });

  const stop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    stderrBuffer += `\nchemx: command ${reason === 'timeout' ? `timed out after ${timeoutMs} ms` : 'cancelled'}; process tree killed.\n`;
    killTree(child, ownsGroup, 'SIGTERM');
    setTimeout(() => killTree(child, ownsGroup, 'SIGKILL'), KILL_GRACE_MS).unref();
  };
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
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
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    const stoppedCode = stopReason === 'timeout' ? TIMEOUT_EXIT_CODE : CANCEL_EXIT_CODE;
    resolve({
      exitCode: stopReason ? stoppedCode : code,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      durationMs: Date.now() - startTime,
      command,
      timedOut: stopReason === 'timeout',
      cancelled: stopReason === 'cancelled'
    });
  };
  child.on('error', (err) => {
    stderrBuffer += `\nProcess error: ${err.message}\n`;
    finish(1);
  });
  child.on('close', (code) => finish(code === null ? 1 : code));
});
