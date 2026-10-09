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

test('executeBuild: a step that outlives its timeout is killed with its children and reports timedOut', { timeout: 15000 }, async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-exec-timeout-'));
  const pidFile = path.join(tmpDir, 'grandchild.pid');
  try {
    const grandchild = `node -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); setInterval(() => {}, 1000)"`;
    const result = await executeBuild(`${grandchild}; echo after`, tmpDir, { timeoutMs: 600 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null, 'a timed-out step carries no exit verdict');
    assert.ok(result.durationMs < 5000, `took ${result.durationMs}ms`);
    assert.match(result.stderr, /Timed out after 600ms/);
    const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
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
