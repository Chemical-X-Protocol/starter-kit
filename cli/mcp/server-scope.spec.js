import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpHandler } from './server.js';
import { startPipeServer, makeFixtureProject, byId, textOf, KIT_ROOT } from './spec-harness.js';

const PKG = JSON.stringify({ name: 'fixture-pkg', version: '4.5.6', scripts: { test: 'node --test' } });
const NO_STALE = { staleness: false };
let seq = 100;
const call = (handler, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: 'chemx', arguments: args } });

test('scope: params.cwd can never widen the project boundary', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'a.txt': 'inside\n' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, ...NO_STALE });
  const escape = await call(handler, { action: 'read', projectRoot: project, params: { path: '/etc/hostname', cwd: '/' } });
  const relative = await call(handler, { action: 'p', projectRoot: project, params: { cwd: '/' } });
  assert.strictEqual(escape.result.isError, true);
  assert.match(textOf(relative), /fixture-pkg@4\.5\.6/);
});

test('scope: projectRoot must look like a project', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-bare-'));
  const handler = createMcpHandler({ bootDir: KIT_ROOT, ...NO_STALE });
  const res = await call(handler, { action: 'p', projectRoot: bare });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), /must be an absolute path to an existing project directory/);
});

test('scope: a boot dir with only package.json is not a root; refusal still carries the root line', async () => {
  const pkgOnly = makeFixtureProject({ 'package.json': PKG }, null);
  const handler = createMcpHandler({ bootDir: pkgOnly, env: {}, ...NO_STALE });
  const res = await call(handler, { action: 'p' });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), /No project root/);
  assert.match(textOf(res), /chemx root: unresolved/);
});

test('scope: CHEMX_PROJECT_ROOT is used, and MCP roots beat it', async () => {
  const envProject = makeFixtureProject({ 'package.json': PKG });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, env: { CHEMX_PROJECT_ROOT: envProject }, ...NO_STALE });
  const res = await call(handler, { action: 'p' });
  assert.match(textOf(res), /fixture-pkg/);
  assert.match(textOf(res), new RegExp(`chemx root: ${envProject} \\(env\\)`));
});

test('scope: wrappers d/log/p/f/j follow projectRoot instead of the server start dir', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'data.json': '{"answer": 42}', 'src/a.store.ts': '' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, ...NO_STALE });
  const pkg = await call(handler, { action: 'p', projectRoot: project });
  const json = await call(handler, { action: 'j', projectRoot: project, params: { path: 'data.json' } });
  const files = await call(handler, { action: 'f', projectRoot: project, params: { filter: '*.store.ts' } });
  const log = await call(handler, { action: 'log', projectRoot: project });
  assert.match(textOf(pkg), /fixture-pkg/);
  assert.match(textOf(json), /"answer": 42/);
  assert.match(textOf(files), /src\/a\.store\.ts/);
  assert.strictEqual(log.result.isError, true, 'git log outside a repo is an error, not empty success');
});

test('roots: the server asks roots/list after initialized and uses the answer (file URI with a space)', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const spaced = path.join(project, 'my app');
  fs.mkdirSync(spaced);
  fs.writeFileSync(path.join(spaced, 'package.json'), JSON.stringify({ name: 'spaced-app', version: '0.0.1' }));
  const pipe = startPipeServer({ bootDir: KIT_ROOT, ...NO_STALE });
  pipe.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: { roots: { listChanged: true } } } });
  await pipe.next(byId(1));
  pipe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  pipe.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'chemx', arguments: { action: 'p' } } });
  const rootsRequest = await pipe.next((f) => f.method === 'roots/list');
  pipe.send({ jsonrpc: '2.0', id: rootsRequest.id, result: { roots: [{ uri: pathToFileURL(spaced).href, name: 'app' }] } });
  const res = await pipe.next(byId(2));
  assert.match(textOf(res), /spaced-app@0\.0\.1/);
  assert.match(textOf(res), /\(mcpRoots\)/);
  pipe.close();
});

test('identity: serverInfo.version is the package.json version and instructions are present', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf-8'));
  const handler = createMcpHandler({ bootDir: KIT_ROOT, ...NO_STALE });
  const init = await handler.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.strictEqual(init.result.serverInfo.version, pkg.version);
  assert.match(init.result.instructions, /action: "help"/);
});

test('identity: a server whose disk version moved on says so on every call', async () => {
  const staleness = { loaded: { version: '1.0.0', fingerprint: 'f' }, readDisk: () => ({ version: '2.0.0', fingerprint: 'f' }) };
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness });
  const res = await call(handler, { action: 'help' });
  assert.match(textOf(res), /stale chemx MCP server \(loaded 1\.0\.0, disk 2\.0\.0\): reconnect via \/mcp/);
});
