// A caller test target must be a path or glob, never a runner option.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createMcpHandler } from './server.js';
import { makeFixtureProject, textOf } from './spec-harness.js';

const NO_STALE = { staleness: false };
let seq = 900;
const callTool = (handler, name, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
const call = (handler, args) => callTool(handler, 'chemx', args);

// Percent-encode everything but letters and digits so the payload passes a path-ish allowlist.
const encode = (s) => [...s].map((c) => (/[A-Za-z0-9]/.test(c) ? c : `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)).join('');
const importPayload = (marker) => `--import=data:text/javascript,${encode(`import{writeFileSync}from"node:fs";writeFileSync(${JSON.stringify(marker)},"x")`)}`;

test('boundary: a test target that is an option never reaches the runner', async () => {
  const project = makeFixtureProject({
    'package.json': JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }),
    'node_modules/.keep': '',
    'a.test.js': "import test from 'node:test'; test('ok', () => {});\n"
  });
  const marker = path.join(project, 'PWNED');
  const target = importPayload(marker);
  const declared = createMcpHandler({ cwd: project, bootDir: project, env: {}, ...NO_STALE });
  const boot = createMcpHandler({ bootDir: project, env: {}, ...NO_STALE });
  const attempts = [
    () => call(declared, { action: 'test', projectRoot: project, params: { target } }),
    () => call(declared, { action: 'test', params: { testTarget: target } }),
    () => call(boot, { action: 'test', params: { target } }),
    () => call(declared, { command: `test --target=${target}` }),
    () => call(declared, { action: 'test', params: { command: 'node --test', target } }),
    () => callTool(declared, 'chemx_test', { target })
  ];
  for (const attempt of attempts) {
    const res = await attempt();
    assert.strictEqual(res.result.isError, true, textOf(res));
    assert.match(textOf(res), /Refusing test target/);
    assert.strictEqual(fs.existsSync(marker), false, 'payload ran');
  }
});
