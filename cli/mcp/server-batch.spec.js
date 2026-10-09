import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpHandler } from './server.js';
import { MCP_TOOLS, ACTION_NAMES } from './tools.js';
import { makeFixtureProject, textOf, KIT_ROOT } from './spec-harness.js';

const PKG = JSON.stringify({ name: 'batch-pkg', version: '1.0.0', scripts: { build: 'echo hi' } });
let seq = 500;
const call = (handler, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: 'chemx', arguments: args } });

test('batch: a mutating item without a declared root refuses the whole batch', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'src/x.ts': 'export const a = 1;\n' });
  const handler = createMcpHandler({ bootDir: project, env: {}, staleness: false });
  const res = await call(handler, { batch: [{ action: 'p' }, { action: 'patch', params: { path: 'src/x.ts', search: 'a = 1', replace: 'a = 3' } }] });
  assert.strictEqual(res.result.isError, true);
  assert.match(textOf(res), /Refusing batch; no item ran/);
  assert.strictEqual(fs.readFileSync(path.join(project, 'src/x.ts'), 'utf-8'), 'export const a = 1;\n');
});

test('batch: an item-level cwd cannot redirect a write outside the root', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-victim-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'hello world');
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  await call(handler, { projectRoot: project, batch: [{ action: 'patch', cwd: outside, params: { path: 'victim.txt', search: 'hello', replace: 'PWNED', cwd: outside } }] });
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf-8'), 'hello world');
  assert.strictEqual(fs.existsSync(path.join(outside, '.chemx')), false);
});

test('batch: a failing item makes the batch fail; text is plain, one block per item', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  const failing = await call(handler, { projectRoot: project, commands: ['p -s', 'p nope'] });
  const passing = await call(handler, { projectRoot: project, commands: ['p -s', 'p build'] });
  assert.strictEqual(failing.result.isError, true);
  assert.match(failing.result.content[0].text, /^batch: fail \(2 items: 1 pass, 1 fail\)/);
  assert.match(textOf(failing), /--- \[fail\] p nope ---/);
  assert.doesNotMatch(textOf(failing), /\{"output"/);
  assert.strictEqual(passing.result.isError, false);
  assert.match(passing.result.content[0].text, /^batch: pass/);
});

test('schema: the action enum is the live dispatcher, help works, dead params are gone', async () => {
  const master = MCP_TOOLS[0].inputSchema.properties;
  assert.deepStrictEqual(master.action.enum, ACTION_NAMES);
  for (const dead of ['trace', 'backtrace', 'do', 'batch']) assert.ok(!master.action.enum.includes(dead), dead);
  assert.strictEqual(master.params.properties.overwrite, undefined);
  assert.ok(master.params.properties.testTarget);
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  const help = await call(handler, { action: 'help' });
  assert.strictEqual(help.result.isError, false);
  assert.match(textOf(help), /^read: \{ path/m);
});

test('envelope: wrapper output is plain text without ANSI or JSON-in-text', async () => {
  const project = makeFixtureProject({ 'package.json': PKG });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  const res = await call(handler, { action: 'p', projectRoot: project, params: { query: '-s' } });
  assert.strictEqual(res.result.content[0].text, 'build: echo hi\n');
  assert.doesNotMatch(textOf(res), /\u001b\[/);
});

test('dryRun: MCP patch with dryRun:true never writes', async () => {
  const project = makeFixtureProject({ 'package.json': PKG, 'src/x.ts': 'export const a = 1;\n' });
  const handler = createMcpHandler({ bootDir: KIT_ROOT, staleness: false });
  const res = await call(handler, { action: 'patch', projectRoot: project, params: { path: 'src/x.ts', search: 'a = 1', replace: 'a = 2', dryRun: true } });
  assert.strictEqual(res.result.isError, false, textOf(res));
  assert.strictEqual(fs.readFileSync(path.join(project, 'src/x.ts'), 'utf-8'), 'export const a = 1;\n');
});
