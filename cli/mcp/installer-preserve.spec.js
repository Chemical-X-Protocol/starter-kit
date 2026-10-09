import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as installer from '../installer.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const SECRET_CONFIG = '{\n  "mcpServers": {\n    "pg": { "command": "pg", "env": { "PGPASSWORD": "s3cret" } }\n  }\n}\n';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const modeOf = (file) => fs.statSync(file).mode & 0o777;
const quietly = (fn) => {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = write; }
};
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

test('install preserve: a hook installed over a CRLF user hook is LF, so git can exec it', () => withDirs((dir) => {
  const hooksDir = path.join(dir, '.git', 'hooks');
  writeFile(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\r\necho CRLF-HOOK\r\n');
  quietly(() => installer.installPreCommitHook(dir, {}));
  const hook = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
  assert.strictEqual(hook.includes('\r'), false, 'no CR anywhere in the chemx hook');
  assert.ok(hook.startsWith('#!/bin/sh\n'));
  assert.strictEqual(fs.readFileSync(path.join(hooksDir, 'pre-commit.bak'), 'utf-8'), '#!/bin/sh\r\necho CRLF-HOOK\r\n');
}));

test('install preserve: a user-edited chemx hook is backed up, an untouched one is not', () => withDirs((dir) => {
  const hooksDir = path.join(dir, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  quietly(() => installer.installPreCommitHook(dir, { minGrade: 'B', minScore: 80 }));
  quietly(() => installer.installPreCommitHook(dir, { minGrade: 'A', minScore: 90 }));
  assert.strictEqual(fs.existsSync(path.join(hooksDir, 'pre-commit.bak')), false, 'untouched chemx hook needs no backup');
  fs.appendFileSync(path.join(hooksDir, 'pre-commit'), 'npm run lint # MY-CUSTOM-LINE\n');
  quietly(() => installer.installPreCommitHook(dir, { minGrade: 'A', minScore: 90 }));
  const backup = path.join(hooksDir, 'pre-commit.bak');
  assert.match(fs.readFileSync(backup, 'utf-8'), /MY-CUSTOM-LINE/);
  assert.strictEqual(modeOf(backup), 0o755, 'the hook backup stays executable');
}));

test('install preserve: a 0600 MCP config and its backup stay 0600', () => withDirs((dir, home) => {
  const cursor = path.join(dir, '.cursor', 'mcp.json');
  const gemini = path.join(home, '.gemini', 'config', 'mcp_config.json');
  for (const file of [cursor, gemini]) { writeFile(file, SECRET_CONFIG); fs.chmodSync(file, 0o600); }
  const result = runCli(['install-mcp', '--global', dir], dir, home);
  assert.strictEqual(result.status, 0, result.stderr);
  for (const file of [cursor, gemini]) {
    assert.match(fs.readFileSync(file, 'utf-8'), /chemical-x/);
    assert.strictEqual(modeOf(file), 0o600, `${file} keeps 0600`);
    assert.strictEqual(modeOf(`${file}.bak`), 0o600, `${file}.bak is 0600 too`);
  }
}));
