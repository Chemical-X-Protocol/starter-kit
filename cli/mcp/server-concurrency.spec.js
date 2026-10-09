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
    const texts = results.map((res) => res.result.content.map((c) => c.text).join('\n'));
    results.forEach((res, i) => {
      assert.strictEqual(res.result.isError, false, texts[i]);
      assert.doesNotMatch(texts[i], /SQLITE_BUSY|database is locked/);
    });
    // An empty index would also pass the checks above (and the "No matching" text echoes the query): each q must name its file.
    for (const n of [0, 1]) {
      assert.match(texts[n * 3], /src\/mod3\.ts/, `server ${n} q value3`);
      assert.match(texts[n * 3 + 2], /src\/mod7\.ts/, `server ${n} q value7`);
    }
    const feed = await servers[0].callChemx({ action: 'team_feed', params: { limit: 10 } });
    const feedText = feed.result.content[0].text;
    assert.match(feedText, /hello from 0/);
    assert.match(feedText, /hello from 1/);
  } finally {
    servers.forEach((s) => s.stop());
  }
});
