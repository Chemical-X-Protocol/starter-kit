// Adversarial MCP boundary specs: the resolved root is the only root a handler ever sees.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpHandler } from './server.js';
import { makeFixtureProject, textOf } from './spec-harness.js';

const NO_STALE = { staleness: false };
let seq = 500;
const callTool = (handler, name, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
const call = (handler, args) => callTool(handler, 'chemx', args);
const bareDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-nomark-'));
const declaredServer = () => {
  const project = makeFixtureProject({ 'package.json': JSON.stringify({ name: 'decl' }), 'victim.txt': 'hello world' });
  return { project, handler: createMcpHandler({ cwd: project, bootDir: project, env: {}, ...NO_STALE }) };
};

test('bypass: an empty top-level projectRoot never lets params.projectRoot pick the write dir', async () => {
  const { handler } = declaredServer();
  const nomark = bareDir();
  fs.writeFileSync(path.join(nomark, 'victim.txt'), 'hello world');
  for (const empty of ['', false, 0]) {
    await call(handler, { action: 'write', projectRoot: empty, params: { projectRoot: nomark, path: 'pwn1.txt', content: 'PWNED' } });
    await call(handler, { action: 'patch', projectRoot: empty, params: { projectRoot: nomark, path: 'victim.txt', target: 'hello', replacement: 'PWNED' } });
  }
  assert.strictEqual(fs.existsSync(path.join(nomark, 'pwn1.txt')), false);
  assert.strictEqual(fs.readFileSync(path.join(nomark, 'victim.txt'), 'utf-8'), 'hello world');
});

test('bypass: batch items with an empty projectRoot cannot redirect to params.projectRoot', async () => {
  const { handler } = declaredServer();
  const nomark = bareDir();
  const res = await call(handler, { commands: [{ action: 'write', projectRoot: '', params: { projectRoot: nomark, path: 'pwn3.txt', content: 'x' } }] });
  assert.strictEqual(fs.existsSync(path.join(nomark, 'pwn3.txt')), false);
  assert.strictEqual(res.result.isError, true);
});

test('bypass: params.projectRoot that disagrees with the resolved root is refused', async () => {
  const { handler, project } = declaredServer();
  const other = makeFixtureProject({ 'package.json': '{}' });
  const res = await call(handler, { action: 'write', projectRoot: project, params: { projectRoot: other, path: 'pwn4.txt', content: 'x' } });
  assert.strictEqual(res.result.isError, true);
  assert.strictEqual(fs.existsSync(path.join(other, 'pwn4.txt')), false);
});

test('bypass: an absolute path never becomes its own root', async () => {
  const { handler } = declaredServer();
  const sibling = makeFixtureProject({ 'package.json': '{}' }, null);
  const target = path.join(sibling, 'pwn5.txt');
  const res = await call(handler, { action: 'write', params: { path: target, content: 'x' } });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), /outside project root/);
  assert.strictEqual(fs.existsSync(target), false);
});

test('bypass: with no declared root an absolute path is refused, not inferred from package.json', async () => {
  const sibling = makeFixtureProject({ 'package.json': '{}' }, null);
  const handler = createMcpHandler({ bootDir: bareDir(), env: {}, ...NO_STALE });
  const target = path.join(sibling, 'pwn6.txt');
  const res = await call(handler, { action: 'write', params: { path: target, content: 'x' } });
  assert.strictEqual(res.result.isError, true);
  assert.strictEqual(fs.existsSync(target), false);
});

test('bypass: audit_build alias and chemx_audit_build tool go through the shell gate', async () => {
  const { handler, project } = declaredServer();
  await call(handler, { action: 'audit_build', params: { command: `touch ${project}/M-alias` } });
  await callTool(handler, 'chemx_audit_build', { command: `touch ${project}/M-tool` });
  assert.strictEqual(fs.existsSync(path.join(project, 'M-alias')), false);
  assert.strictEqual(fs.existsSync(path.join(project, 'M-tool')), false);
});

test('bypass: test target and filter cannot carry shell syntax', async () => {
  const project = makeFixtureProject({ 'package.json': JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }), 'node_modules/.keep': '' });
  const handler = createMcpHandler({ cwd: project, bootDir: project, env: {}, ...NO_STALE });
  const target = await call(handler, { action: 'test', params: { target: 'a.spec.js; touch M1' } });
  const filter = await call(handler, { action: 'test', params: { filter: '$(touch M2)' } });
  const command = await call(handler, { command: 'test a.spec.js;touch${IFS}M3' });
  const testTarget = await call(handler, { action: 'test', params: { testTarget: 'a.spec.js|touch M4' } });
  for (const res of [target, filter, command, testTarget]) assert.strictEqual(res.result.isError, true);
  for (const marker of ['M1', 'M2', 'M3', 'M4']) assert.strictEqual(fs.existsSync(path.join(project, marker)), false, marker);
});

test('bypass: git wrappers refuse --output and --no-index', async () => {
  const project = makeFixtureProject({ 'package.json': '{}' });
  const handler = createMcpHandler({ bootDir: project, env: {}, ...NO_STALE });
  const out = path.join(project, 'written-by-diff.txt');
  const cases = [
    { action: 'd', params: { args: [`--output=${out}`] } },
    { action: 'log', params: { args: ['--output', out] } },
    { action: 'diff', params: { args: [`--outp=${out}`] } },
    { action: 'd', params: { args: ['--no-index', '/etc/hostname', '/dev/null'] } },
    { command: `d --no-index /etc/hostname /dev/null` }
  ];
  for (const args of cases) {
    const res = await call(handler, args);
    assert.strictEqual(res.result.isError, true, JSON.stringify(args));
    assert.match(textOf(res), /Refusing git option/);
  }
  assert.strictEqual(fs.existsSync(out), false);
});

test('bypass: a path escape refusal still names the resolved root', async () => {
  const project = makeFixtureProject({ 'package.json': '{}' });
  const handler = createMcpHandler({ bootDir: bareDir(), env: {}, ...NO_STALE });
  const res = await call(handler, { action: 'j', projectRoot: project, params: { path: '/etc/os-release' } });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), new RegExp(`chemx root: ${project} \\(projectRoot\\)`));
});

test('bypass: a batch item that is itself a batch is refused before anything runs', async () => {
  const { handler, project } = declaredServer();
  const res = await call(handler, { commands: [{ commands: [{ action: 'write', params: { path: 'nested.txt', content: 'x' } }] }] });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), /cannot themselves be batches/);
  assert.strictEqual(fs.existsSync(path.join(project, 'nested.txt')), false);
});

test('envelope: structured failures set isError, and batch agrees with single calls', async () => {
  const { toEnvelope } = await import('./envelope.js');
  const { statusOfResult } = await import('./batch.js');
  const failures = [{ success: false, exitCode: 1 }, { error: 'Unknown lock action: x' }, { status: 'fail' }];
  for (const output of failures) {
    assert.strictEqual(toEnvelope(output).isError, true, JSON.stringify(output));
    assert.strictEqual(statusOfResult(output), 'fail', JSON.stringify(output));
  }
  const passes = [{ success: true }, { error: null, items: [] }, { status: 'pass', success: true }];
  for (const output of passes) {
    assert.strictEqual(toEnvelope(output).isError, false, JSON.stringify(output));
    assert.strictEqual(statusOfResult(output), 'pass', JSON.stringify(output));
  }
  assert.strictEqual(toEnvelope({ status: 'inconclusive', success: false }).isError, false);
});
