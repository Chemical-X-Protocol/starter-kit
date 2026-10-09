import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeMcpServerConfig, installProjectMcpConfig, installAllMcpConfigs, installAntigravityMcpConfig } from './installer.js';

const POSTINSTALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'postinstall.js');
const SERVER = { command: 'chemx', args: ['mcp'] };
const JSONC_INPUT = `{
  // my servers
  "servers": { "github": { "command": "gh-mcp" } },
  "mcpServers": { "postgres": { "command": "pg" }, },
}`;

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));

test('install safety: JSONC with comments is refused, never returned without the other servers', () => {
  assert.throws(() => mergeMcpServerConfig(JSONC_INPUT, SERVER), /comments/);
});

test('install safety: trailing commas parse and every other server is kept', () => {
  const input = '{ "servers": { "github": { "command": "gh-mcp" }, }, "mcpServers": { "postgres": { "command": "pg" }, }, }';
  const merged = JSON.parse(mergeMcpServerConfig(input, SERVER));
  assert.strictEqual(merged.servers.github.command, 'gh-mcp');
  assert.strictEqual(merged.mcpServers.postgres.command, 'pg');
  assert.deepStrictEqual(merged.mcpServers['chemical-x'], SERVER);
});

test('install safety: unparseable config is refused and left byte-identical', () => {
  const dir = tmp('chemx-inst-bad-');
  try {
    const cursorFile = path.join(dir, '.cursor', 'mcp.json');
    writeFile(cursorFile, '{ "mcpServers": ');
    const res = installProjectMcpConfig(dir, { silent: true });
    assert.strictEqual(res.cursor, false);
    assert.strictEqual(fs.readFileSync(cursorFile, 'utf-8'), '{ "mcpServers": ');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install safety: VS Code gets servers + type stdio, JSONC file untouched, stale entry dropped', () => {
  const dir = tmp('chemx-inst-vscode-');
  try {
    const vscodeFile = path.join(dir, '.vscode', 'mcp.json');
    writeFile(vscodeFile, JSON.stringify({ mcpServers: { 'chemical-x': SERVER, other: { command: 'x' } } }));
    installProjectMcpConfig(dir, { silent: true, addScripts: false });
    const vscode = readJson(vscodeFile);
    assert.strictEqual(vscode.servers['chemical-x'].type, 'stdio');
    assert.strictEqual(vscode.mcpServers['chemical-x'], undefined);
    assert.strictEqual(vscode.mcpServers.other.command, 'x');

    writeFile(vscodeFile, JSONC_INPUT);
    const res = installProjectMcpConfig(dir, { silent: true, addScripts: false });
    assert.strictEqual(res.vscode, false);
    assert.strictEqual(res.refused.length, 1);
    assert.strictEqual(fs.readFileSync(vscodeFile, 'utf-8'), JSONC_INPUT);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install safety: rewrite keeps a .bak of the previous file and is idempotent', () => {
  const dir = tmp('chemx-inst-bak-');
  try {
    const cursorFile = path.join(dir, '.cursor', 'mcp.json');
    const original = JSON.stringify({ mcpServers: { mine: { command: 'm' } } });
    writeFile(cursorFile, original);
    installProjectMcpConfig(dir, { silent: true });
    assert.strictEqual(fs.readFileSync(`${cursorFile}.bak`, 'utf-8'), original);
    assert.strictEqual(readJson(cursorFile).mcpServers.mine.command, 'm');
    const afterFirst = fs.readFileSync(cursorFile, 'utf-8');
    fs.rmSync(`${cursorFile}.bak`);
    installProjectMcpConfig(dir, { silent: true });
    assert.strictEqual(fs.readFileSync(cursorFile, 'utf-8'), afterFirst);
    assert.strictEqual(fs.existsSync(`${cursorFile}.bak`), false, 'unchanged file is not rewritten');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install safety: home-directory config is written only with includeHome', () => {
  const dir = tmp('chemx-inst-proj-');
  const home = tmp('chemx-inst-home-');
  try {
    fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
    const configFile = path.join(home, '.gemini', 'config', 'mcp_config.json');
    installAllMcpConfigs(dir, { silent: true, homeDir: home });
    assert.strictEqual(fs.existsSync(configFile), false);
    assert.strictEqual(fs.existsSync(path.join(home, '.gemini', 'antigravity')), false);
    assert.strictEqual(installAntigravityMcpConfig(dir, { silent: true, homeDir: home, includeHome: true }), true);
    assert.ok(readJson(configFile).mcpServers['chemical-x']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install safety: npm postinstall writes nothing into the consumer project or home', () => {
  const dir = tmp('chemx-postinstall-');
  const home = tmp('chemx-postinstall-home-');
  try {
    fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
    writeFile(path.join(dir, 'package.json'), '{"name":"consumer"}');
    const env = { ...process.env, INIT_CWD: dir, HOME: home, CI: '' };
    const run = spawnSync(process.execPath, [POSTINSTALL], { cwd: dir, env, encoding: 'utf-8' });
    assert.strictEqual(run.status, 0);
    assert.deepStrictEqual(fs.readdirSync(dir), ['package.json']);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'), '{"name":"consumer"}');
    assert.deepStrictEqual(fs.readdirSync(path.join(home, '.gemini', 'config')), []);
    assert.ok(run.stderr.split('\n').filter(Boolean).length <= 1, 'at most a one-line hint');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
