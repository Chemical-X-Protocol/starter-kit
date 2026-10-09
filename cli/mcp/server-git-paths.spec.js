// git wrappers over MCP: every path argument must resolve inside the root.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMcpHandler } from './server.js';
import { makeFixtureProject, textOf } from './spec-harness.js';

const NO_STALE = { staleness: false };
let seq = 900;
const callTool = (handler, name, args) => handler.handleRequest({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
const call = (handler, args) => callTool(handler, 'chemx', args);
const realTmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const makeRepoWithSecret = () => {
  const project = makeFixtureProject({ 'package.json': '{"name":"p"}', 'src/a.js': 'export const a = 1;\n' });
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['add', '-A'], { cwd: project });
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init'], { cwd: project });
  const secretDir = realTmp('chemx-secret-');
  const secret = path.join(secretDir, 'secret.txt');
  fs.writeFileSync(secret, 'TOP-SECRET-OUTSIDE-ROOT\n');
  return { project, secret };
};

test('boundary: d and log refuse paths outside the root (implicit --no-index, ../, rev:path)', async () => {
  const { project, secret } = makeRepoWithSecret();
  const handler = createMcpHandler({ cwd: project, bootDir: project, env: {}, ...NO_STALE });
  const cases = [
    { action: 'd', params: { args: ['/dev/null', secret] } },
    { command: `d /dev/null ${secret}` },
    { action: 'd', params: { args: ['--', secret] } },
    { action: 'd', params: { args: ['HEAD', '--', '../outside'] } },
    { action: 'log', params: { args: ['-p', '--', '../outside'] } },
    { action: 'log', params: { args: ['-p', 'HEAD:../outside.txt'] } },
    { action: 'd', params: { args: [':/'] } }
  ];
  for (const args of cases) {
    const res = await call(handler, args);
    assert.strictEqual(res.result.isError, true, JSON.stringify(args));
    assert.doesNotMatch(textOf(res), /TOP-SECRET/, JSON.stringify(args));
    assert.match(textOf(res), /outside project root|Refusing git argument/, JSON.stringify(args));
  }
  const fine = [
    { action: 'd', params: { args: ['HEAD', '--', 'src'] } },
    { action: 'd', params: { args: ['--stat'] } },
    { action: 'log', params: { args: ['-n', '5', '--', 'src/a.js'] } },
    { action: 'log', params: { args: ['HEAD~0..HEAD'] } }
  ];
  for (const args of fine) {
    const res = await call(handler, args);
    assert.strictEqual(res.result.isError, false, `${JSON.stringify(args)}: ${textOf(res)}`);
  }
});
