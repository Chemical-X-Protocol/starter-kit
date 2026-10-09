import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMcpHandler } from './server.js';
import { scheduleTimeout } from '../timers.js';
import { createFreshRunner, timeoutMsFor } from './fresh-runner.js';
import { RESULT_MARK } from './fresh-protocol.js';
import { FRESH_NOTICE } from './stale-exec.js';
import { SERVER_INFO } from './server-info.js';
import { makeFixtureProject, KIT_ROOT } from './spec-harness.js';

const PKG = JSON.stringify({ name: 'fixture-pkg', version: '4.5.6' });
const STALE = { loaded: { version: '1.0.0', fingerprint: 'a' }, readDisk: () => ({ version: '1.0.0', fingerprint: 'b' }) };
let seq = 400;
const call = (handler, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: 'chemx', arguments: args } });
const itemsOf = (res) => res.result.content.map((c) => c.text);
const joined = (res) => itemsOf(res).join('');

const fakeSpawn = (stdoutText, code = 0) => () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => {} });
  scheduleTimeout(() => {
    child.stdout.write(stdoutText);
    scheduleTimeout(() => child.emit('close', code), 20);
  }, 5);
  return child;
};

test('stale probe: the call runs in the fresh process, notice on its own first line, footer separated', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const seen = [];
  const runFresh = async (request) => { seen.push(request); return { kind: 'ok', output: 'FRESH-RESULT' }; };
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: STALE, runFresh });
  const res = await call(handler, { action: 'p', projectRoot: project });
  const items = itemsOf(res);
  assert.strictEqual(items[0], `${FRESH_NOTICE}\n`);
  assert.strictEqual(items[1], 'FRESH-RESULT');
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].root, project);
  assert.strictEqual(seen[0].toolName, 'chemx');
  assert.match(joined(res), /\(projectRoot\) v[^\n]*\nstale chemx MCP server/);
});

test('stale probe: the runner spawns node on the entry, writes the request to stdin and parses the marked result', async () => {
  const written = [];
  const stdoutText = `noise\n${RESULT_MARK}${JSON.stringify({ output: 'OUT' })}\n`;
  const spawn = (...args) => {
    written.push(args);
    return fakeSpawn(stdoutText)();
  };
  const run = createFreshRunner({ spawn, entry: '/entry.js' });
  const result = await run({ toolName: 'chemx', toolArgs: { action: 'p' }, root: '/r', env: { A: '1' } });
  assert.deepStrictEqual(result, { kind: 'ok', output: 'OUT' });
  assert.deepStrictEqual(written[0][1], ['/entry.js']);
  assert.deepStrictEqual(written[0][2].env, { A: '1' });
  assert.strictEqual(written[0][2].cwd, '/r');
});

test('stale probe: the call timeout is honored, with a grace period', () => {
  assert.strictEqual(timeoutMsFor({ params: { timeout: 30 } }), 35000);
  assert.strictEqual(timeoutMsFor({ params: {} }), 605000);
});

test('fresh runner: a child that prints no result is a load failure, a tool error is not', async () => {
  const broken = createFreshRunner({ spawn: fakeSpawn('', 1) });
  const failed = createFreshRunner({ spawn: fakeSpawn(`${RESULT_MARK}${JSON.stringify({ error: 'bad path' })}\n`) });
  const loadResult = await broken({ toolName: 'chemx', toolArgs: {}, root: '/r', env: {} });
  const errorResult = await failed({ toolName: 'chemx', toolArgs: {}, root: '/r', env: {} });
  assert.strictEqual(loadResult.kind, 'load');
  assert.match(loadResult.message, /exited 1 without a result/);
  assert.deepStrictEqual(errorResult, { kind: 'error', error: 'bad path' });
});

test('load failure: mutating calls are refused and change nothing', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'a.txt': 'one\n' });
  const runFresh = async () => ({ kind: 'load', message: 'SyntaxError: spec-broken' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: STALE, runFresh });
  const res = await call(handler, { action: 'patch', projectRoot: project, params: { path: 'a.txt', agentId: '@spec-a', blocks: [{ search: 'one', replace: 'two' }] } });
  assert.strictEqual(res.result.isError, true);
  assert.match(joined(res), /Refusing a mutating call/);
  assert.match(joined(res), /SyntaxError: spec-broken/);
  assert.strictEqual(fs.readFileSync(path.join(project, 'a.txt'), 'utf-8'), 'one\n');
});

test('load failure: read-only calls run on the loaded code under a prominent warning', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'a.txt': 'one\n' });
  const runFresh = async () => ({ kind: 'load', message: 'SyntaxError: spec-broken' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: STALE, runFresh });
  const res = await call(handler, { action: 'read', projectRoot: project, params: { path: 'a.txt' } });
  const items = itemsOf(res);
  assert.strictEqual(res.result.isError, false);
  assert.match(items[0], /^WARNING: stale chemx MCP server/);
  assert.match(items[0], /SyntaxError: spec-broken/);
  assert.ok(items[0].endsWith('\n'));
  assert.match(joined(res), /one/);
});

test('a current server never spawns and adds no banner', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const runFresh = async () => { throw new Error('must not spawn'); };
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false, runFresh });
  const res = await call(handler, { action: 'p', projectRoot: project });
  assert.match(itemsOf(res)[0], /fixture-pkg/);
});

test('serverInfo.version is the package version plus the loaded cli fingerprint', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf-8'));
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  const init = await handler.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.strictEqual(init.result.serverInfo.version, SERVER_INFO.version);
  assert.match(init.result.serverInfo.version, new RegExp(`^${pkg.version.replace(/[.]/g, '\\.')}\\+cli\\.[0-9a-f]{12}$`));
});

test('integration: a stale server really spawns the fresh process for a read on a temp project', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'a.txt': 'fresh-body\n' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: STALE });
  const res = await call(handler, { action: 'read', projectRoot: project, params: { path: 'a.txt' } });
  const items = itemsOf(res);
  assert.strictEqual(res.result.isError, false);
  assert.strictEqual(items[0], `${FRESH_NOTICE}\n`);
  assert.match(joined(res), /fresh-body/);
});
