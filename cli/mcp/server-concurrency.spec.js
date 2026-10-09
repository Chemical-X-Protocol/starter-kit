import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeFixtureProject, KIT_ROOT } from './spec-harness.js';

const CLI = path.join(KIT_ROOT, 'cli', 'index.js');

const startServer = (dir) => {
  const child = spawn(process.execPath, [CLI, 'mcp', dir], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const frame = JSON.parse(line);
      pending.get(frame.id)?.(frame);
    }
  });
  let seq = 0;
  const request = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const callChemx = (args) => request('tools/call', { name: 'chemx', arguments: args });
  return { request, callChemx, stop: () => child.kill() };
};

test('concurrency: two server instances share one .chemx/index.db without errors', async () => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/mod${i}.ts`, `export const value${i} = ${i};\n`]));
  const dir = makeFixtureProject({ 'package.json': '{"name":"conc"}', ...files });
  const servers = [startServer(dir), startServer(dir)];
  try {
    await Promise.all(servers.map((s) => s.request('initialize', {})));
    const calls = servers.flatMap((s, n) => [
      s.callChemx({ action: 'q', params: { query: 'value3', reindex: true } }),
      s.callChemx({ action: 'team_post', params: { message: `hello from ${n}`, authorId: `@agent${n}` } }),
      s.callChemx({ action: 'q', params: { query: 'value7' } })
    ]);
    const results = await Promise.all(calls);
    for (const res of results) {
      const text = res.result.content.map((c) => c.text).join('\n');
      assert.strictEqual(res.result.isError, false, text);
      assert.doesNotMatch(text, /SQLITE_BUSY|database is locked/);
    }
    const feed = await servers[0].callChemx({ action: 'team_feed', params: { limit: 10 } });
    const feedText = feed.result.content[0].text;
    assert.match(feedText, /hello from 0/);
    assert.match(feedText, /hello from 1/);
  } finally {
    servers.forEach((s) => s.stop());
  }
});
