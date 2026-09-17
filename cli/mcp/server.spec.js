import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { createMcpHandler, startStdioServer } from './server.js';
import { MCP_TOOLS, Tools, executeMcpTool } from './tools.js';

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
  assert.strictEqual(res.result.capabilities.resources.subscribe, true);
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
  assert.strictEqual(toolNames.length, 11);
  assert.ok(toolNames.includes('chemx_query_patterns'));
  assert.ok(toolNames.includes('chemx_audit'));
  assert.ok(toolNames.includes('chemx_generate_capsule'));
  assert.ok(toolNames.includes('chemx_get_refactor_prompt'));
  assert.ok(toolNames.includes('chemx_audit_build'));
  assert.ok(toolNames.includes('chemx_autofix'));
  assert.ok(toolNames.includes('chemx_q'));
  assert.ok(toolNames.includes('chemx_read'));
  assert.ok(toolNames.includes('chemx_patch'));
  assert.ok(toolNames.includes('chemx_write'));
  assert.ok(toolNames.includes('chemx_check'));
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

  const viewBlueprintRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 91,
    method: 'resources/read',
    params: { uri: 'chemx://blueprints/view-template' }
  });
  assert.strictEqual(viewBlueprintRes.jsonrpc, '2.0');
  assert.ok(viewBlueprintRes.result.contents[0].text.includes('ViewTemplate'));

  const molBlueprintRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 92,
    method: 'resources/read',
    params: { uri: 'chemx://blueprints/molecule' }
  });
  assert.strictEqual(molBlueprintRes.jsonrpc, '2.0');
  assert.ok(molBlueprintRes.result.contents[0].text.length > 50);

  // Test fallback in an isolated directory with no .chemx or blueprints directory
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-empty-'));
  try {
    const isolatedHandler = createMcpHandler({ cwd: emptyDir });
    const fallbackRes = await isolatedHandler.handleRequest({
      jsonrpc: '2.0',
      id: 93,
      method: 'resources/read',
      params: { uri: 'chemx://blueprints/molecule' }
    });
    assert.strictEqual(fallbackRes.jsonrpc, '2.0');
    assert.ok(fallbackRes.result.contents[0].text.includes('MSampleCard'));
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
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

test('MCP Server: tools/call chemx_autofix performs deterministic cleanup', async () => {
  const handler = createMcpHandler();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-autofix-'));
  const testFile = path.join(tempDir, 'sample.ts');
  fs.writeFileSync(testFile, 'const title = "Dashboard — Analytics";\n// hope this helps', 'utf-8');

  // Dry run
  const dryRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 15,
    method: 'tools/call',
    params: {
      name: 'chemx_autofix',
      arguments: { path: testFile, dryRun: true }
    }
  });

  assert.strictEqual(dryRes.result.isError, false);
  const dryData = JSON.parse(dryRes.result.content[0].text);
  assert.strictEqual(dryData.dryRun, true);
  assert.strictEqual(dryData.totalFixes, 2);
  assert.strictEqual(dryData.filesChanged, 1);

  // Live run
  const liveRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: {
      name: 'chemx_autofix',
      arguments: { path: testFile, dryRun: false }
    }
  });

  assert.strictEqual(liveRes.result.isError, false);
  const liveData = JSON.parse(liveRes.result.content[0].text);
  assert.strictEqual(liveData.dryRun, false);
  assert.strictEqual(liveData.totalFixes, 2);
  assert.strictEqual(fs.readFileSync(testFile, 'utf-8'), 'const title = "Dashboard - Analytics";');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('MCP Server: tools/call chemx_query_patterns supports compact mode', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 17,
    method: 'tools/call',
    params: {
      name: 'chemx_query_patterns',
      arguments: {
        dir: 'blueprints',
        compact: true,
        minOccurrences: 1
      }
    }
  });

  assert.strictEqual(res.result.isError, false);
  const data = JSON.parse(res.result.content[0].text);
  assert.strictEqual(data.compact, true);
  if (data.candidates.length > 0) {
    const first = data.candidates[0];
    assert.ok(Array.isArray(first.files));
    assert.ok(Array.isArray(first.sampleOccurrences));
    assert.strictEqual(first.occurrences, undefined);
  }
});

test('MCP Server: resources/subscribe and resources/unsubscribe', async () => {
  const handler = createMcpHandler();

  const subRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 18,
    method: 'resources/subscribe',
    params: { uri: 'chemx://scorecard' }
  });
  assert.strictEqual(subRes.jsonrpc, '2.0');
  assert.deepStrictEqual(subRes.result, {});
  assert.ok(handler.getSubscriptions().includes('chemx://scorecard'));

  const notification = handler.notifyResourceUpdated('chemx://scorecard');
  assert.strictEqual(notification.method, 'notifications/resources/updated');
  assert.strictEqual(notification.params.uri, 'chemx://scorecard');

  const unsubRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 19,
    method: 'resources/unsubscribe',
    params: { uri: 'chemx://scorecard' }
  });
  assert.strictEqual(unsubRes.jsonrpc, '2.0');
  assert.deepStrictEqual(unsubRes.result, {});
  assert.ok(!handler.getSubscriptions().includes('chemx://scorecard'));
});

test('MCP Server: resources/read chemx://scorecard returns streamlined summary', async () => {
  const handler = createMcpHandler();
  const readRes = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 20,
    method: 'resources/read',
    params: { uri: 'chemx://scorecard' }
  });

  assert.strictEqual(readRes.jsonrpc, '2.0');
  const scorecard = JSON.parse(readRes.result.contents[0].text);
  assert.ok(typeof scorecard.grade === 'string');
  assert.ok(typeof scorecard.score === 'number');
  assert.ok(scorecard.severityRollup);
  assert.ok(Array.isArray(scorecard.topHotspots));
  assert.ok(typeof scorecard.totalViolations === 'number');
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

test('MCP Server: tools/call chemx_q searches symbols and capsules', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 101,
    method: 'tools/call',
    params: {
      name: 'chemx_q',
      arguments: {
        query: 'badge',
        tier: 'all',
        inspect: true
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const results = JSON.parse(res.result.content[0].text);
  assert.ok(Array.isArray(results));
});

test('MCP Server: tools/call chemx_read extracts outline without full file dump', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'chemx_read',
      arguments: {
        path: 'blueprints/molecule-capsule/m-chemx-badge/m-chemx-badge.tsx',
        outline: true
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const text = res.result.content[0].text;
  assert.ok(text.includes('m-chemx-badge.tsx'));
  assert.ok(text.includes('tokens'));
});

test('MCP Server: tools/call chemx_patch surgically modifies target content', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-mcp-'));
  const testFile = path.join(tmpDir, 'sample.ts');
  fs.writeFileSync(testFile, 'const greeting = "hello world";\n', 'utf-8');

  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 103,
    method: 'tools/call',
    params: {
      name: 'chemx_patch',
      arguments: {
        path: testFile,
        targetContent: 'hello world',
        replacementContent: 'hello chemical-x'
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const updated = fs.readFileSync(testFile, 'utf-8');
  assert.ok(updated.includes('hello chemical-x'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MCP Server: tools/call chemx_write creates and indexes file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-write-'));
  const testFile = path.join(tmpDir, 'sample-written.ts');
  const handler = createMcpHandler();

  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 1031,
    method: 'tools/call',
    params: {
      name: 'chemx_write',
      arguments: {
        path: testFile,
        content: 'export const writtenConstant = 123;\n'
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const written = fs.readFileSync(testFile, 'utf-8');
  assert.ok(written.includes('export const writtenConstant = 123;'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MCP Server: tools/call chemx_q supports columnar format', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 1032,
    method: 'tools/call',
    params: {
      name: 'chemx_q',
      arguments: {
        query: 'tab',
        columnar: true
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const payload = JSON.parse(res.result.content[0].text);
  assert.ok(Array.isArray(payload.cols));
  assert.ok(Array.isArray(payload.rows));
  assert.ok(payload.cols.includes('path'));
  assert.ok(payload.cols.includes('tier'));
});

test('MCP Server: tools/call chemx_check verifies single file boundary rules', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 104,
    method: 'tools/call',
    params: {
      name: 'chemx_check',
      arguments: {
        path: 'blueprints/molecule-capsule/m-chemx-badge/m-chemx-badge.tsx'
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.result.isError, false);
  const checkRes = JSON.parse(res.result.content[0].text);
  assert.strictEqual(typeof checkRes.file, 'string');
  assert.strictEqual(typeof checkRes.isClean, 'boolean');
  assert.strictEqual(typeof checkRes.violationsCount, 'number');
});

test('MCP Server: resources/read chemx://blueprints/molecule enforces Zero Raw DOM', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 105,
    method: 'resources/read',
    params: { uri: 'chemx://blueprints/molecule' }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  const blueprintText = res.result.contents[0].text;
  assert.ok(blueprintText.length > 0);
  assert.ok(!blueprintText.includes('<div className="m-sample-card">'));
  assert.ok(!blueprintText.includes('<button type="button"'));
});

test('MCP Server: prompts/get chemx_remediate_hotspot dynamically hydrates diagnostics', async () => {
  const handler = createMcpHandler();
  const res = await handler.handleRequest({
    jsonrpc: '2.0',
    id: 106,
    method: 'prompts/get',
    params: {
      name: 'chemx_remediate_hotspot',
      arguments: {
        filePath: 'blueprints/molecule-capsule/m-chemx-badge/m-chemx-badge.tsx'
      }
    }
  });

  assert.strictEqual(res.jsonrpc, '2.0');
  const userText = res.result.messages[0].content.text;
  assert.ok(userText.includes('LIVE AST DIAGNOSTICS'));
  assert.ok(userText.includes('Total Lines:'));
});

test('MCP Tools: keyed Tools map contains all handlers and executes mapped methods', async () => {
  assert.strictEqual(typeof Tools, 'object');
  const toolKeys = Object.keys(Tools);
  assert.strictEqual(toolKeys.length, 11);

  for (const tool of MCP_TOOLS) {
    assert.strictEqual(typeof Tools[tool.name], 'function', `Tools.${tool.name} must be a function`);
  }

  // Direct keyed execution: const handle = Tools[n]; handle(args, cwd)
  const handle = Tools['chemx_q'];
  const res = handle({ query: 'badge', columnar: true });
  assert.ok(res);
  assert.ok(Array.isArray(res.cols));
  assert.ok(Array.isArray(res.rows));

  // executeMcpTool throws for unmapped tool names
  await assert.rejects(
    async () => executeMcpTool('unknown_nonexistent_tool'),
    /Unknown tool: unknown_nonexistent_tool/
  );
});


