// MCP parity: the test, verify and build handlers expose --allow-empty and --timeout like the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleChemxTest, handleAuditBuild, handleChemxTypecheck } from './tools-verify.js';
import { ALL_MCP_TOOLS, MASTER_MCP_TOOL } from './manifests.js';

const withEmptyProject = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-verify-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'm', type: 'module', scripts: { test: 'node --test src/*.spec.js' } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('mcp tools-verify: allowEmpty reaches the test run', { timeout: 60000 }, async () => {
  await withEmptyProject(async (root) => {
    const strict = await handleChemxTest({}, root);
    assert.equal(strict.status, 'inconclusive');
    const allowed = await handleChemxTest({ allowEmpty: true }, root);
    assert.equal(allowed.status, 'pass');
    assert.equal(allowed.reason, 'EMPTY_ALLOWED');
  });
});

test('mcp tools-verify: a timeout (seconds) stops test and build runs as inconclusive', { timeout: 60000 }, async () => {
  await withEmptyProject(async (root) => {
    const testRun = await handleChemxTest({ command: 'sleep 20', timeout: 0.5 }, root);
    assert.equal(testRun.status, 'inconclusive');
    assert.equal(testRun.reason, 'STEP_TIMEOUT');
    const build = await handleAuditBuild({ command: 'sleep 20', timeout: 0.5 }, root);
    assert.equal(build.status, 'inconclusive');
    const typecheck = await handleChemxTypecheck({ timeout: 'soon' }, root);
    assert.equal(typecheck.reason, 'USAGE', 'an invalid timeout is a usage error, as on the CLI');
  });
});

test('mcp tools-verify: the manifests document allowEmpty and timeout', () => {
  const props = (name) => ALL_MCP_TOOLS.find((tool) => tool.name === name).inputSchema.properties;
  for (const name of ['chemx_test', 'chemx_verify']) assert.ok(props(name).allowEmpty, `${name} allowEmpty`);
  for (const name of ['chemx_test', 'chemx_verify', 'chemx_typecheck', 'chemx_audit_build']) assert.ok(props(name).timeout, `${name} timeout`);
  const master = MASTER_MCP_TOOL.inputSchema.properties.params.properties;
  assert.ok(master.allowEmpty && master.timeout && master.includeBuild);
});
