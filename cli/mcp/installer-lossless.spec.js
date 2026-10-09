import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as installer from '../installer.js';
import { installProjectMcpConfig } from './installer.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const USER_HOOK = '#!/bin/sh\necho MY-USER-HOOK\n';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const quietly = (fn) => {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = write; }
};
const hookFilesContaining = (hooksDir, marker) => fs.readdirSync(hooksDir)
  .filter((name) => name.startsWith('pre-commit'))
  .filter((name) => fs.readFileSync(path.join(hooksDir, name), 'utf-8').includes(marker));

test('install lossless: re-installing the hook with new options keeps the user hook backup', () => {
  const dir = tmp('chemx-hook-twice-');
  try {
    const hooksDir = path.join(dir, '.git', 'hooks');
    writeFile(path.join(hooksDir, 'pre-commit'), USER_HOOK);
    quietly(() => installer.installPreCommitHook(dir, { minGrade: 'B', minScore: 80 }));
    quietly(() => installer.installPreCommitHook(dir, { minGrade: 'A', minScore: 90 }));
    assert.strictEqual(fs.readFileSync(path.join(hooksDir, 'pre-commit.bak'), 'utf-8'), USER_HOOK);
    assert.match(fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8'), /MIN_SCORE:-90/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install lossless: a second user hook gets its own backup, the first .bak is never overwritten', () => {
  const dir = tmp('chemx-hook-second-');
  try {
    const hooksDir = path.join(dir, '.git', 'hooks');
    writeFile(path.join(hooksDir, 'pre-commit'), USER_HOOK);
    quietly(() => installer.installPreCommitHook(dir, {}));
    writeFile(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho SECOND-HOOK\n');
    quietly(() => installer.installPreCommitHook(dir, {}));
    assert.deepStrictEqual(hookFilesContaining(hooksDir, 'MY-USER-HOOK'), ['pre-commit.bak']);
    assert.strictEqual(hookFilesContaining(hooksDir, 'SECOND-HOOK').length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install lossless: a symlinked config is written through the link', () => {
  const dir = tmp('chemx-mcp-link-');
  try {
    const target = path.join(dir, 'dot', 'cursor.json');
    writeFile(target, '{ "mcpServers": { "github": { "command": "gh" } } }');
    const link = path.join(dir, 'proj', '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), target), link);
    installProjectMcpConfig(path.join(dir, 'proj'), { silent: true, addScripts: false });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link stays a link');
    const merged = JSON.parse(fs.readFileSync(target, 'utf-8'));
    assert.ok(merged.mcpServers['chemical-x']);
    assert.strictEqual(merged.mcpServers.github.command, 'gh');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install lossless: CRLF line endings are kept', () => {
  const dir = tmp('chemx-mcp-crlf-');
  try {
    const file = path.join(dir, '.cursor', 'mcp.json');
    writeFile(file, '{\r\n  "mcpServers": {\r\n    "github": { "command": "gh" }\r\n  }\r\n}\r\n');
    installProjectMcpConfig(dir, { silent: true, addScripts: false });
    const text = fs.readFileSync(file, 'utf-8');
    assert.ok(text.includes('chemical-x'));
    assert.strictEqual(/(^|[^\r])\n/.test(text), false, 'no bare LF');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install lossless: install-mcp leaves no package.json.bak and exits 1 when it refuses a file', () => {
  const dir = tmp('chemx-mcp-exit-');
  const home = tmp('chemx-mcp-exit-home-');
  try {
    writeFile(path.join(dir, 'package.json'), '{\n  "name": "consumer"\n}\n');
    const env = { ...process.env, HOME: home, CI: '' };
    const ok = spawnSync(process.execPath, [CLI, 'install-mcp', dir], { cwd: dir, env, encoding: 'utf-8' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.strictEqual(fs.existsSync(path.join(dir, 'package.json.bak')), false);
    writeFile(path.join(dir, '.vscode', 'mcp.json'), '{\n  // mine\n  "servers": {}\n}\n');
    const partial = spawnSync(process.execPath, [CLI, 'install-mcp', dir], { cwd: dir, env, encoding: 'utf-8' });
    assert.strictEqual(partial.status, 1);
    assert.match(partial.stderr + partial.stdout, /VS Code/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install lossless: only the wizard option that names ~/.gemini writes the home directory', () => {
  const { planWizardTargets } = installer;
  assert.strictEqual(typeof planWizardTargets, 'function');
  assert.strictEqual(planWizardTargets('1').includeHome, false);
  assert.strictEqual(planWizardTargets('1').shouldMcp, true);
  assert.strictEqual(planWizardTargets('2').includeHome, true);
  assert.strictEqual(planWizardTargets('5').shouldHook, true);
  assert.strictEqual(planWizardTargets('5').shouldWf, false);
});
