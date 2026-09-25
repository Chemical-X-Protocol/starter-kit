import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { openIndexDb } from '../search-schema.js';
import { createTask, getTask } from './team-db-tasks.js';
import { getFileLockStatus } from './team-db-locks.js';

const runWorkerScript = (cwd, code) => {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), pid: child.pid });
    });
    child.on('error', reject);
  });
};

test('swarm multi-process: 4 worker processes contend to claim single task', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-multiprocess-claim-'));
  const db = openIndexDb(tmpDir);
  const task = createTask(db, { title: 'Contended Task #1', status: 'queued' });

  const workerCode = (workerId) => `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { claimTask } from '${path.resolve('cli/team/team-db-tasks.js')}';
    const db = openIndexDb('${tmpDir}');
    const res = claimTask(db, ${task.id}, '@worker-${workerId}');
    console.log(JSON.stringify(res));
  `;

  const workerPromises = [0, 1, 2, 3].map((id) => runWorkerScript(tmpDir, workerCode(id)));
  const results = await Promise.all(workerPromises);

  const parsed = results.map((r) => {
    assert.strictEqual(r.code, 0, `Worker failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  });

  const successCount = parsed.filter((p) => p.success === true).length;
  const alreadyClaimedCount = parsed.filter((p) => p.success === false && p.reason === 'already_claimed').length;

  assert.strictEqual(successCount, 1, 'Exactly one worker must claim the task');
  assert.strictEqual(alreadyClaimedCount, 3, 'Three workers must be rejected with already_claimed');

  const finalTask = getTask(db, task.id);
  assert.strictEqual(finalTask.status, 'in_progress');
  assert.ok(finalTask.assigned_agent_id.startsWith('@worker-'));

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { void err; }
});

test('swarm multi-process: file lock contention and FIFO promotion across processes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-multiprocess-locks-'));
  const db = openIndexDb(tmpDir);
  const testFile = 'src/components/ContendedCard.tsx';

  // Active process acquires lock on behalf of @worker-0 with live PID
  const w0Res = (await import('./team-db-locks.js')).requestFileLock(db, testFile, '@worker-0', { pid: process.pid });
  assert.strictEqual(w0Res.granted, true);

  const acquireScript = (workerId) => `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { requestFileLock } from '${path.resolve('cli/team/team-db-locks.js')}';
    const db = openIndexDb('${tmpDir}');
    const res = requestFileLock(db, '${testFile}', '@worker-${workerId}');
    console.log(JSON.stringify(res));
  `;

  // Workers 1, 2, 3 contend in separate child processes
  const q1 = await runWorkerScript(tmpDir, acquireScript(1));
  const q2 = await runWorkerScript(tmpDir, acquireScript(2));
  const q3 = await runWorkerScript(tmpDir, acquireScript(3));

  for (const q of [q1, q2, q3]) {
    assert.strictEqual(q.code, 0);
    const parsed = JSON.parse(q.stdout);
    assert.strictEqual(parsed.granted, false);
    assert.strictEqual(parsed.queued, true);
  }

  const statusBeforeRelease = getFileLockStatus(db, testFile);
  assert.strictEqual(statusBeforeRelease.lease.locked_by, '@worker-0');
  assert.strictEqual(statusBeforeRelease.waiters.length, 3);
  assert.strictEqual(statusBeforeRelease.waiters[0].agent_id, '@worker-1');
  assert.strictEqual(statusBeforeRelease.waiters[1].agent_id, '@worker-2');
  assert.strictEqual(statusBeforeRelease.waiters[2].agent_id, '@worker-3');

  // Release lock from worker 0 in child process and assert FIFO waiter is promoted
  const releaseScript = `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { releaseFileLock } from '${path.resolve('cli/team/team-db-locks.js')}';
    const db = openIndexDb('${tmpDir}');
    const res = releaseFileLock(db, '${testFile}', '@worker-0');
    console.log(JSON.stringify(res));
  `;
  const relRes = await runWorkerScript(tmpDir, releaseScript);
  assert.strictEqual(relRes.code, 0);
  const relParsed = JSON.parse(relRes.stdout);
  assert.strictEqual(relParsed.success, true);
  assert.strictEqual(relParsed.promotedWaiter, '@worker-1');

  const statusAfterRelease = getFileLockStatus(db, testFile);
  assert.strictEqual(statusAfterRelease.lease.locked_by, '@worker-1');
  assert.strictEqual(statusAfterRelease.waiters.length, 2);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { void err; }
});

test('swarm multi-process: lock automatically releases when holding worker process crashes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-multiprocess-crash-'));
  const db = openIndexDb(tmpDir);
  const testFile = 'src/crash-target.ts';

  // Spawn child process that acquires lock and immediately exits (crashes)
  const crashScript = `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { requestFileLock } from '${path.resolve('cli/team/team-db-locks.js')}';
    const db = openIndexDb('${tmpDir}');
    requestFileLock(db, '${testFile}', '@crashing-worker', { ttlMs: 3600000, pid: process.pid });
    process.exit(1);
  `;

  const crashRun = await runWorkerScript(tmpDir, crashScript);
  assert.strictEqual(crashRun.code, 1);

  // New healthy worker requests lock; deceased worker's lock should be reclaimed
  const healthyScript = `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { requestFileLock } from '${path.resolve('cli/team/team-db-locks.js')}';
    const db = openIndexDb('${tmpDir}');
    const res = requestFileLock(db, '${testFile}', '@healthy-worker');
    console.log(JSON.stringify(res));
  `;

  const healthyRun = await runWorkerScript(tmpDir, healthyScript);
  assert.strictEqual(healthyRun.code, 0, `Healthy worker failed: ${healthyRun.stderr}`);
  const healthyParsed = JSON.parse(healthyRun.stdout);

  assert.strictEqual(healthyParsed.granted, true, 'Healthy worker must acquire lock reclaimed from dead process');
  assert.strictEqual(healthyParsed.lease.locked_by, '@healthy-worker');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { void err; }
});

test('swarm multi-process: multiple worker processes race to mark tasks done', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-multiprocess-done-'));
  const db = openIndexDb(tmpDir);

  const tasks = [0, 1, 2, 3].map((i) => createTask(db, {
    title: `Concurrent Done Task #${i}`,
    status: 'in_progress',
    assigned_agent_id: `@finisher-${i}`
  }));

  const doneScript = (taskId, workerId) => `
    import { openIndexDb } from '${path.resolve('cli/search-schema.js')}';
    import { updateTaskStatus } from '${path.resolve('cli/team/team-db-tasks.js')}';
    const db = openIndexDb('${tmpDir}');
    const res = updateTaskStatus(db, ${taskId}, 'done', {
      resultPayload: { finishedBy: '@finisher-${workerId}' }
    });
    console.log(JSON.stringify({ success: Boolean(res && res.status === 'done') }));
  `;

  const racers = tasks.map((t, idx) => runWorkerScript(tmpDir, doneScript(t.id, idx)));
  const results = await Promise.all(racers);

  for (const r of results) {
    assert.strictEqual(r.code, 0, `Done worker failed: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.success, true);
  }

  for (const t of tasks) {
    const finalTask = getTask(db, t.id);
    assert.strictEqual(finalTask.status, 'done');
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { void err; }
});
