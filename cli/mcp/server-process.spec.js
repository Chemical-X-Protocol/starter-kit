import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { executeBuild } from '../build/executor.js';
import { startPipeServer, makeFixtureProject, byId, KIT_ROOT } from './spec-harness.js';

const CLI = path.join(KIT_ROOT, 'cli', 'index.js');
const PKG = JSON.stringify({ name: 'proc-pkg', version: '1.0.0', scripts: { build: 'echo built' } });
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('executor: a timeout kills the whole process tree and reports timedOut', async () => {
  const dir = makeFixtureProject({ 'package.json': PKG });
  const result = await executeBuild('sleep 30 & echo $! > child.pid; wait', dir, { timeoutMs: 300 });
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.exitCode, 124);
  assert.ok(result.durationMs < 5000);
  const grandchild = Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf-8'));
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(isAlive(grandchild), false, 'background grandchild was killed');
});

test('executor: an abort signal cancels the child', async () => {
  const dir = makeFixtureProject({ 'package.json': PKG });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const result = await executeBuild('sleep 30', dir, { signal: controller.signal });
  assert.strictEqual(result.cancelled, true);
  assert.ok(result.durationMs < 5000);
});

test('stdio e2e: a stdin-reading child cannot steal JSON-RPC frames meant for the server', async () => {
  const dir = makeFixtureProject({ 'package.json': PKG });
  const server = spawn(process.execPath, [CLI, 'mcp', dir], { cwd: dir, env: { ...process.env, CHEMX_MCP_ALLOW_SHELL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const answered = new Set();
  let buffered = '';
  server.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines.filter(Boolean)) answered.add(JSON.parse(line).id);
  });
  const send = (msg) => server.stdin.write(`${JSON.stringify(msg)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'chemx', arguments: { action: 'build', projectRoot: dir, params: { command: 'head -n 1 > stolen.txt; echo done' } } } });
  for (let id = 3; id <= 6; id++) send({ jsonrpc: '2.0', id, method: 'ping' });
  const deadline = Date.now() + 20000;
  while (answered.size < 6 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  server.kill();
  assert.deepStrictEqual([...answered].sort(), [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'stolen.txt'), 'utf-8'), '');
});

test('progress and cancellation: heartbeats while running, no response after notifications/cancelled', async () => {
  const dir = makeFixtureProject({ 'package.json': PKG });
  const pipe = startPipeServer({ bootDir: KIT_ROOT, env: { CHEMX_MCP_ALLOW_SHELL: '1' }, progressIntervalMs: 100, staleness: false });
  pipe.send({ jsonrpc: '2.0', id: 'slow', method: 'tools/call', params: { name: 'chemx', _meta: { progressToken: 'tok' }, arguments: { action: 'build', projectRoot: dir, params: { command: 'sleep 20' } } } });
  const progress = await pipe.next((f) => f.method === 'notifications/progress');
  assert.strictEqual(progress.params.progressToken, 'tok');
  pipe.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'slow', reason: 'user' } });
  pipe.send({ jsonrpc: '2.0', id: 'after', method: 'ping' });
  await pipe.next(byId('after'));
  await new Promise((r) => setTimeout(r, 2500));
  assert.strictEqual(pipe.frames.some(byId('slow')), false, 'cancelled request gets no response');
  pipe.close();
});

test('scorecard: the audit runs off the event loop and keeps hotspot violation counts', async () => {
  const pipe = startPipeServer({ bootDir: KIT_ROOT, staleness: false });
  pipe.send({ jsonrpc: '2.0', id: 'card', method: 'resources/read', params: { uri: 'chemx://scorecard' } });
  pipe.send({ jsonrpc: '2.0', id: 'ping', method: 'ping' });
  await pipe.next(byId('ping'));
  const isPingFirst = !pipe.frames.some(byId('card'));
  const card = JSON.parse((await pipe.next(byId('card'), 60000)).result.contents[0].text);
  assert.strictEqual(isPingFirst, true, 'ping answered while the scorecard audit was still running');
  for (const hotspot of card.topHotspots) assert.strictEqual(typeof hotspot.violations, 'number');
  pipe.close();
});

test('offload: a directory audit runs off the event loop so ping is answered first', async () => {
  const pipe = startPipeServer({ bootDir: KIT_ROOT, staleness: false });
  pipe.send({ jsonrpc: '2.0', id: 'audit', method: 'tools/call', params: { name: 'chemx', arguments: { action: 'audit', projectRoot: KIT_ROOT, params: { dir: 'cli' } } } });
  await new Promise((r) => setTimeout(r, 400));
  pipe.send({ jsonrpc: '2.0', id: 'ping2', method: 'ping' });
  await pipe.next(byId('ping2'));
  const isPingFirst = !pipe.frames.some(byId('audit'));
  const audit = await pipe.next(byId('audit'), 120000);
  assert.strictEqual(isPingFirst, true);
  assert.strictEqual(audit.result.isError, false, audit.result.content[0].text);
  pipe.close();
});
