import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { createMcpHandler, startStdioServer } from './server.js';
import { MCP_TOOLS } from './tools.js';

test('MCP Server: initialize handshake', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.id, 1);
  assert.strictEqual(res.result.protocolVersion, '2024-11-05');
  assert.ok(res.result.capabilities.tools);
  assert.ok(res.result.capabilities.resources);
  assert.ok(res.result.capabilities.prompts);
  assert.strictEqual(res.result.serverInfo.name, 'chemical-x-mcp');
});

test('MCP Server: ping returns empty result', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping'
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.id, 2);
  assert.deepStrictEqual(res.result, {});
});

test('MCP Server: tools/list enumerates all Chemical X tools', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list'
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  const toolNames = res.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('chemx_query_patterns'));
  assert.ok(toolNames.includes('chemx_audit'));
  assert.ok(toolNames.includes('chemx_generate_capsule'));
  assert.ok(toolNames.includes('chemx_get_refactor_prompt'));
  assert.ok(toolNames.includes('chemx_audit_build'));
});

test('MCP Server: tools/call chemx_query_patterns executes AST discovery', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'chemx_query_patterns',
      arguments: {
        dir: 'blueprints',
        type: 'ALL',
        minOccurrences: 1
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const data = JSON.parse(res.result.content[0].text);
  assert.strictEqual(typeof data.totalCandidates, 'number');
  assert.ok(Array.isArray(data.candidates));
});

test('MCP Server: tools/call chemx_audit audits codebase', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'chemx_audit',
      arguments: {
        path: 'blueprints/molecule-capsule/m-chemx-badge/m-chemx-badge.tsx'
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const data = JSON.parse(res.result.content[0].text);
  assert.strictEqual(data.type, 'file');
  assert.ok(Array.isArray(data.violations));
});

test('MCP Server: tools/call chemx_generate_capsule generates crystalline capsule', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-test-'));

  try {
    const handler = createMcpHandler({ cwd: tmpDir });
    const res = await handler.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'chemx_generate_capsule',
        arguments: {
          name: 'm-spark-kpi',
          framework: 'vue',
          tier: 'm',
          targetDir: tmpDir
        }
      }
    });

    assert.strictEqual(res.result.isError, false);
    const data = JSON.parse(res.result.content[0].text);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.capsuleName, 'm-spark-kpi');
    assert.strictEqual(data.framework, 'vue');

    const createdDir = path.join(tmpDir, 'm-spark-kpi');
    assert.ok(fs.existsSync(createdDir));
    assert.ok(fs.existsSync(path.join(createdDir, 'm-spark-kpi.vue')));
    assert.ok(fs.existsSync(path.join(createdDir, 'm-spark-kpi.controller.ts')));
    assert.ok(fs.existsSync(path.join(createdDir, '_m-spark-kpi.scss')));
    assert.ok(fs.existsSync(path.join(createdDir, 'types.d.ts')));
    assert.ok(fs.existsSync(path.join(createdDir, 'index.ts')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server: tools/call chemx_get_refactor_prompt returns prompt', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'chemx_get_refactor_prompt',
      arguments: {
        dir: 'blueprints',
        scope: 'master'
      }
    }
  });

  assert.strictEqual(res.result.isError, false);
  const data = JSON.parse(res.result.content[0].text);
  assert.strictEqual(typeof data.prompt, 'string');
});

test('MCP Server: resources/list and resources/read', async () => {
  const handler = createMcpHandler();
  const listRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 8,
    method: 'resources/list'
  });

  assert.ok(listRes.result.resources.length >= 4);

  const readRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 9,
    method: 'resources/read',
    params: { uri: 'chemx://directives' }
  });

  assert.strictEqual(readRes.jsonrpc, '2.0');
  assert.strictEqual(readRes.result.contents[0].uri, 'chemx://directives');
  assert.ok(readRes.result.contents[0].text.length > 50);
});

test('MCP Server: prompts/list and prompts/get', async () => {
  const handler = createMcpHandler();
  const listRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'prompts/list'
  });

  assert.ok(listRes.result.prompts.length >= 2);

  const getRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'prompts/get',
    params: {
      name: 'chemx_remediate_hotspot',
      arguments: { filePath: 'src/views/Monolith.vue' }
    }
  });

  assert.strictEqual(getRes.jsonrpc, '2.0');
  assert.ok(getRes.result.messages[0].content.text.includes('src/views/Monolith.vue'));
});

test('MCP Server: handles unknown method with -32601', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 12,
    method: 'non_existent_method'
  });

  assert.strictEqual(res.error.code, -32601);
});

test('MCP Server: handles unknown tool call with isError: true', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: { name: 'non_existent_tool' }
  });

  assert.strictEqual(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes('Unknown tool'));
});

test('MCP Server: stdio streaming handles line-buffered JSON-RPC', async () => {
  const inStream = new PassThrough();
  const outStream = new PassThrough();

  startStdioServer({ input: inStream, output: outStream });

  const outputs = [];
  outStream.on('data', (chunk) => {
    outputs.push(chunk.toString());
  });

  inStream.write(JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'ping' }) + '\n');

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(outputs.length > 0);
  const parsed = JSON.parse(outputs.join('').trim());
  assert.strictEqual(parsed.id, 100);
  assert.deepStrictEqual(parsed.result, {});
});
