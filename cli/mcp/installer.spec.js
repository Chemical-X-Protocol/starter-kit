import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  mergeMcpServerConfig,
  resolveMcpServerCommand,
  installProjectMcpConfig,
  installAllMcpConfigs
} from './installer.js';

test('mergeMcpServerConfig: creates valid config when input is empty', () => {
  const res = mergeMcpServerConfig('', { command: 'npx', args: ['chemx', 'mcp'] });
  const parsed = JSON.parse(res);
  assert.ok(parsed.mcpServers);
  assert.strictEqual(parsed.mcpServers['chemical-x'].command, 'npx');
});

test('mergeMcpServerConfig: preserves existing servers while updating chemical-x', () => {
  const existing = JSON.stringify({
    mcpServers: {
      'existing-server': { command: 'node', args: ['./server.js'] }
    }
  });

  const res = mergeMcpServerConfig(existing, { command: 'npx', args: ['-y', 'chemx', 'mcp'] });
  const parsed = JSON.parse(res);

  assert.ok(parsed.mcpServers['existing-server']);
  assert.strictEqual(parsed.mcpServers['existing-server'].command, 'node');
  assert.ok(parsed.mcpServers['chemical-x']);
  assert.strictEqual(parsed.mcpServers['chemical-x'].command, 'npx');
});

test('resolveMcpServerCommand: falls back to npx when no local node_modules found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-cmd-test-'));
  try {
    const cmd = resolveMcpServerCommand(tmpDir);
    assert.strictEqual(cmd.command, 'npx');
    assert.deepStrictEqual(cmd.args, ['-y', 'chemx', 'mcp']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveMcpServerCommand: detects local node_modules/create-chemx', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-cmd-test-'));
  try {
    const mockBin = path.join(tmpDir, 'node_modules', 'create-chemx', 'cli', 'index.js');
    fs.mkdirSync(path.dirname(mockBin), { recursive: true });
    fs.writeFileSync(mockBin, '// mock', 'utf-8');

    const cmd = resolveMcpServerCommand(tmpDir);
    assert.strictEqual(cmd.command, 'node');
    assert.strictEqual(cmd.args[0], './node_modules/create-chemx/cli/index.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('installProjectMcpConfig: creates .cursor and .vscode configs and updates package.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-inst-test-'));
  try {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'test-app', scripts: { dev: 'vite' } }), 'utf-8');

    const res = installProjectMcpConfig(tmpDir, { silent: true });
    assert.strictEqual(res.cursor, true);
    assert.strictEqual(res.vscode, true);
    assert.strictEqual(res.packageJson, true);

    const cursorPath = path.join(tmpDir, '.cursor', 'mcp.json');
    assert.ok(fs.existsSync(cursorPath));
    const cursorJson = JSON.parse(fs.readFileSync(cursorPath, 'utf-8'));
    assert.ok(cursorJson.mcpServers['chemical-x']);

    const vscodePath = path.join(tmpDir, '.vscode', 'mcp.json');
    assert.ok(fs.existsSync(vscodePath));

    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    assert.strictEqual(updatedPkg.scripts['chemx:mcp'], 'chemx mcp');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('installAllMcpConfigs: runs without throwing in mock environment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-inst-all-'));
  try {
    const res = installAllMcpConfigs(tmpDir, { silent: true });
    assert.strictEqual(res.cursor, true);
    assert.strictEqual(res.vscode, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
