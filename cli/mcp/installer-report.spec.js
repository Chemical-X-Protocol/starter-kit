import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installProjectMcpConfig } from './installer.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const JSONC_VSCODE = '{\n  // mine\n  "servers": {}\n}\n';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const withDirs = (fn) => {
  const dir = tmp('chemx-preserve-');
  const home = tmp('chemx-preserve-home-');
  try { return fn(dir, home); } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
};
const runCli = (args, dir, home) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: dir, env: { ...process.env, HOME: home, CI: '', NO_COLOR: '1' }, encoding: 'utf-8'
});

test('install report: `chemx mcp --install` exits 1 on a refused file, like install-mcp', () => withDirs((dir, home) => {
  writeFile(path.join(dir, '.vscode', 'mcp.json'), JSONC_VSCODE);
  const viaMcp = runCli(['mcp', '--install', dir], dir, home);
  assert.strictEqual(viaMcp.status, 1, viaMcp.stdout + viaMcp.stderr);
}));

test('install report: --global without ~/.gemini/config says so and is inconclusive', () => withDirs((dir, home) => {
  const result = runCli(['install-mcp', '--global', dir], dir, home);
  assert.match(result.stdout + result.stderr, /Antigravity.*not (configured|found)/i);
  assert.strictEqual(result.status, 3);
}));

test('install report: a refused run names what it already wrote (partial apply)', () => withDirs((dir, home) => {
  writeFile(path.join(dir, '.vscode', 'mcp.json'), JSONC_VSCODE);
  const result = runCli(['install-mcp', dir], dir, home);
  assert.strictEqual(result.status, 1);
  assert.match(result.stdout + result.stderr, /partial/i);
  assert.match(result.stdout + result.stderr, /\.cursor\/mcp\.json/);
}));

test('install report: a minified package.json stays on one line', () => withDirs((dir) => {
  writeFile(path.join(dir, 'package.json'), '{"name":"x","scripts":{"a":"b"}}');
  installProjectMcpConfig(dir, { silent: true });
  const text = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
  assert.strictEqual(text.trim().includes('\n'), false, text);
  assert.strictEqual(JSON.parse(text).scripts['chemx:verify'], 'chemx verify');
}));

test('install report: a package.json with comments is refused, not stripped', () => withDirs((dir) => {
  const original = '{\n  // keep me\n  "name": "x"\n}\n';
  writeFile(path.join(dir, 'package.json'), original);
  const result = installProjectMcpConfig(dir, { silent: true });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'), original);
  assert.strictEqual(result.packageJson, false);
}));

test('install report: install-hooks keeps a minified package.json on one line', async () => withDirs(async (dir) => {
  const { ensurePackageScripts } = await import('../installer.js');
  writeFile(path.join(dir, 'package.json'), '{"name":"x"}\n');
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { ensurePackageScripts(dir); } finally { process.stdout.write = write; }
  const text = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
  assert.strictEqual(text, '{"name":"x","scripts":{"chemx":"chemx"}}\n');
}));
