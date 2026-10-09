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
