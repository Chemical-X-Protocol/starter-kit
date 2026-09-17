import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  mergeMcpServerConfig,
  resolveMcpServerCommand,
  installProjectMcpConfig,
  installAllMcpConfigs,
  syncAntigravityMcpSchemas
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
    assert.strictEqual(updatedPkg.scripts['chemx:verify'], 'chemx verify');
    assert.strictEqual(updatedPkg.scripts['chemx:test'], 'chemx test');
    assert.strictEqual(updatedPkg.scripts['chemx:typecheck'], 'chemx typecheck');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('syncAntigravityMcpSchemas: writes all 14 tool schemas and instructions.md', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-antigravity-test-'));
  try {
    const res = syncAntigravityMcpSchemas(tmpDir, { silent: true });
    assert.strictEqual(res.toolCount, 14);
    assert.ok(fs.existsSync(path.join(tmpDir, 'chemx_verify.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'chemx_typecheck.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'chemx_test.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'instructions.md')));

    const instructions = fs.readFileSync(path.join(tmpDir, 'instructions.md'), 'utf-8');
    assert.ok(instructions.includes('chemx_verify'));
    assert.ok(instructions.includes('MANDATORY VERIFICATION'));
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
