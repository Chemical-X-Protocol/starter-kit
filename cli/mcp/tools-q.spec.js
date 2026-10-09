import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpHandler } from './server.js';
import { clearDbCache } from '../search-db.js';

const callQ = async (handler, args) => {
  const res = await handler.handleRequest({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'chemx_q', arguments: args } });
  return res.result.content[0].text;
};

test('MCP chemx_q sees files created and deleted outside chemx (no ghost results)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-q-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.mkdirSync(path.join(root, 'src', 'mechanics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'mechanics', 'useSeed.ts'), 'export const useSeed = () => 0;\n');
  const handler = createMcpHandler();
  try {
    const warm = await callQ(handler, { query: 'useSeed', cwd: root });
    assert.match(warm, /useSeed/);

    const target = path.join(root, 'src', 'mechanics', 'useZebraFreshness.ts');
    fs.writeFileSync(target, 'export function useZebraFreshness() { return 1; }\n');
    const created = await callQ(handler, { query: 'useZebraFreshness', cwd: root });
    assert.match(created, /src\/mechanics\/useZebraFreshness\.ts:1 definition useZebraFreshness/);

    fs.rmSync(target);
    const deleted = await callQ(handler, { query: 'useZebraFreshness', cwd: root });
    assert.doesNotMatch(deleted, /useZebraFreshness\.ts/, 'deleted file is not served');
    assert.match(deleted, /# index: scope src/);
  } finally {
    clearDbCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP chemx_q literal mode searches the repo without writing to stdout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-lit-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'remember --x-glass tokens\n');
  const handler = createMcpHandler();
  const originalWrite = process.stdout.write;
  let leaked = '';
  process.stdout.write = (chunk, ...rest) => { leaked += String(chunk); return true; };
  try {
    const text = await callQ(handler, { query: '--x-glass', literal: true, cwd: root });
    process.stdout.write = originalWrite;
    const payload = JSON.parse(text);
    assert.equal(payload.totalMatches, 1);
    assert.equal(payload.matches[0].path, 'notes.md');
    assert.equal(leaked, '', 'nothing is written to the JSON-RPC stdout channel');
  } finally {
    process.stdout.write = originalWrite;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP chemx_q honours the advertised trace and backtrace params', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-trace-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'base.ts'), 'export const useBase = () => helper();\nconst helper = () => 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'page.ts'), "import { useBase } from './base';\nexport const usePage = () => useBase();\n");
  const handler = createMcpHandler();
  try {
    const back = JSON.parse(await callQ(handler, { query: 'useBase', backtrace: true, cwd: root }));
    assert.deepEqual(back.callers.map((c) => c.path), ['src/page.ts']);
    assert.ok(back.index, 'backtrace answer carries the index envelope');
    const trace = JSON.parse(await callQ(handler, { query: 'usePage', trace: true, cwd: root }));
    assert.equal(trace.target, 'usePage');
    assert.ok(Array.isArray(trace.callees));
  } finally {
    clearDbCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
