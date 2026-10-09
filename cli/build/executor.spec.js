import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeBuild } from './executor.js';

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('executeBuild: a step that outlives its timeout is killed with its children and reports timedOut', { timeout: 20000 }, async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-exec-timeout-'));
  const pidFile = path.join(tmpDir, 'grandchild.pid');
  try {
    const grandchild = `node -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); setInterval(() => {}, 1000)"`;
    const result = await executeBuild(`${grandchild}; echo after`, tmpDir, { timeoutMs: 2500 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null, 'a timed-out step carries no exit verdict');
    assert.ok(result.durationMs < 8000, `took ${result.durationMs}ms`);
    assert.match(result.stderr, /Timed out after 2500ms/);
    const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 20 && isAlive(grandchildPid); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(isAlive(grandchildPid), false, 'grandchild process must not be orphaned');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('executeBuild: stdin is detached so a runner waiting on input sees EOF instead of hanging', { timeout: 15000 }, async () => {
  const command = `node -e "process.stdin.on('data', () => {}).on('end', () => console.log('eof:' + Boolean(process.stdin.isTTY)))"`;
  const result = await executeBuild(command, process.cwd(), { timeoutMs: 5000 });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /eof:false/);
});

test('executeBuild: a finished command keeps its exit code and timedOut false', async () => {
  const result = await executeBuild('node -e "process.exit(3)"', process.cwd(), { timeoutMs: 5000 });
  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
});

// Drives executeBuild in its own chemx-like process: step one waits forever, step two marks
// that it ran. A signal sent to that process must take step one's runner down with it.
const runSignalledDriver = async (signal) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-exec-signal-'));
  const pidFile = path.join(tmpDir, 'runner.pid');
  const markerFile = path.join(tmpDir, 'second-step-ran');
  const driverFile = path.join(tmpDir, 'driver.mjs');
  const executorUrl = new URL('./executor.js', import.meta.url).href;
  const waitForever = `node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)" ${pidFile}`;
  const markSecond = `node -e "require('fs').writeFileSync(process.argv[1], 'x')" ${markerFile}`;
  fs.writeFileSync(driverFile, [
    `import { executeBuild } from ${JSON.stringify(executorUrl)};`,
    `await executeBuild(${JSON.stringify(waitForever)}, ${JSON.stringify(tmpDir)});`,
    `await executeBuild(${JSON.stringify(markSecond)}, ${JSON.stringify(tmpDir)});`
  ].join('\n'));
  const { spawn } = await import('node:child_process');
  const driver = spawn(process.execPath, [driverFile], { stdio: 'ignore' });
  const exited = new Promise((resolve) => driver.on('exit', (code, sig) => resolve({ code, sig })));
  for (let i = 0; i < 300 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
  const runnerPid = Number(fs.readFileSync(pidFile, 'utf8'));
  driver.kill(signal);
  const outcome = await exited;
  for (let i = 0; i < 20 && isAlive(runnerPid); i++) await new Promise((r) => setTimeout(r, 100));
  const result = { ...outcome, runnerAlive: isAlive(runnerPid), secondStepRan: fs.existsSync(markerFile) };
  if (result.runnerAlive) process.kill(runnerPid, 'SIGKILL');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return result;
};

test('executeBuild: SIGTERM to chemx kills the running runner group and chemx exits 143', { timeout: 30000, skip: process.platform === 'win32' }, async () => {
  const result = await runSignalledDriver('SIGTERM');
  assert.equal(result.runnerAlive, false, 'the runner must not be orphaned when chemx is terminated');
  assert.equal(result.code, 143);
  assert.equal(result.secondStepRan, false);
});

test('executeBuild: SIGINT stops chemx with exit 130 instead of moving on to the next step', { timeout: 30000, skip: process.platform === 'win32' }, async () => {
  const result = await runSignalledDriver('SIGINT');
  assert.equal(result.runnerAlive, false);
  assert.equal(result.code, 130, 'Ctrl+C must stop chemx, not just the current step');
  assert.equal(result.secondStepRan, false, 'no further step may start after an interrupt');
});

test('executeBuild: signal listeners are removed once no runner is active', async () => {
  const before = ['SIGINT', 'SIGTERM', 'exit'].map((name) => process.listenerCount(name));
  await executeBuild('node -e "0"', process.cwd(), { timeoutMs: 5000 });
  assert.deepEqual(['SIGINT', 'SIGTERM', 'exit'].map((name) => process.listenerCount(name)), before);
});
