import { spawn } from 'node:child_process';

const KILL_GRACE_MS = 2000;
const canSignalGroups = process.platform !== 'win32';

// Kill the whole process group so `npm run x` cannot orphan the runner it spawned.
// Returns whether the group signal landed; on failure it falls back to the direct child.
const killTree = (child, signal) => {
  try {
    if (canSignalGroups) process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    child.kill(signal);
    return error.code !== 'ESRCH';
  }
};

// Returns the timer handle so the caller owns its disposal (cleared in settle()).
const armTimer = (delayMs, onFire) => {
  const timer = setTimeout(onFire, delayMs);
  return timer;
};

// A child must not inherit node:test's harness context, or a nested `node --test` reports
// to a parent that is not listening and prints no TAP summary at all.
const childEnv = (extraEnv = {}) => {
  const { NODE_TEST_CONTEXT, ...parentEnv } = process.env;
  return { ...parentEnv, FORCE_COLOR: '1', ...extraEnv };
};

// Runs a shell command with stdin detached (no runner can enter watch mode or wait on a prompt),
// buffers output, and enforces an optional timeout. Result: { exitCode, stdout, stderr, durationMs,
// command, timedOut }. A timed-out run reports exitCode null so callers cannot mistake it for a verdict.
export const executeBuild = (command, cwd = process.cwd(), options = {}) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let isSettled = false;

    const isRawStream = Boolean(options.raw);
    const timeoutMs = Number(options.timeoutMs) || 0;
    const hasTimeout = timeoutMs > 0;

    const child = spawn(command, {
      shell: true,
      cwd,
      detached: canSignalGroups,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(options.env)
    });

    const forwardInterrupt = () => killTree(child, 'SIGINT');
    process.once('SIGINT', forwardInterrupt);

    let killTimer = null;
    const timeoutTimer = hasTimeout
      ? armTimer(timeoutMs, () => {
        timedOut = true;
        killTree(child, 'SIGTERM');
        killTimer = armTimer(KILL_GRACE_MS, () => killTree(child, 'SIGKILL'));
      })
      : null;

    const settle = (exitCode) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      process.removeListener('SIGINT', forwardInterrupt);
      if (timedOut) stderrBuffer += `\nTimed out after ${timeoutMs}ms: ${command}\n`;
      resolve({
        exitCode: timedOut ? null : exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs: Date.now() - startTime,
        command,
        timedOut
      });
    };

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

    child.on('error', (err) => {
      stderrBuffer += `\nProcess error: ${err.message}\n`;
      settle(1);
    });

    child.on('close', (code, signal) => {
      const wasSignalled = code === null;
      if (wasSignalled && signal) stderrBuffer += `\nProcess killed by ${signal}\n`;
      settle(wasSignalled ? 1 : code);
    });
  });
};
