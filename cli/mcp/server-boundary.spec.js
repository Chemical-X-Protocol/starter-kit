// Round-2 MCP boundary specs: symlinks, declared-root limits, batch root line.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpHandler } from './server.js';
import { makeFixtureProject, textOf } from './spec-harness.js';

const NO_STALE = { staleness: false };
let seq = 900;
const callTool = (handler, name, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
const call = (handler, args) => callTool(handler, 'chemx', args);
const realTmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

test('boundary: a symlink inside the root cannot carry a write or read outside it', async () => {
  const base = realTmp('chemx-link-');
  const project = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, '.chemxrc'), '{}');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE-ROOT\n');
  fs.symlinkSync('../outside', path.join(project, 'link'));
  const handler = createMcpHandler({ cwd: project, bootDir: project, env: {}, ...NO_STALE });
  const write = await call(handler, { action: 'write', projectRoot: project, params: { path: 'link/pwn.js', content: 'x' } });
  assert.strictEqual(write.result.isError, true);
  assert.match(textOf(write), /outside project root/);
  assert.strictEqual(fs.existsSync(path.join(outside, 'pwn.js')), false);
  const read = await call(handler, { action: 'read', params: { path: 'link/secret.txt' } });
  assert.strictEqual(read.result.isError, true);
  assert.doesNotMatch(textOf(read), /TOP-SECRET/);
  const plain = await call(handler, { action: 'write', projectRoot: project, params: { path: 'new/dir/ok.js', content: 'x' } });
  assert.strictEqual(plain.result.isError, false, textOf(plain));
});
