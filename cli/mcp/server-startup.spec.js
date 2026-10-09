import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localModules } from '../spec-support/run-cli.js';

// startup-latency-eager-imports: `initialize` must not wait on the tool stack.
// Tool handlers, the audit engine and Babel load on the first call that needs them.
// audit/social-git.js is exempt: the error catcher loads it for every CLI run.
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(here, '..', 'index.js');
const TRACER_PATH = path.resolve(here, '..', 'spec-support', 'import-trace.mjs');
const HEAVY_MODULE = /^cli\/(audit\.js|audit-engine\.js|audit\/(?!social-git).*|mcp\/tools-(?!lazy).*|generator.*|search\.js|reader\.js|patcher\.js|verify.*|build\.js|team\/.*)$/;

const readModules = (traceFile) => {
  const lines = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').split('\n') : [];
  return [...new Set(lines.filter((line) => line.startsWith('file:') || line.startsWith('node:')))];
};

const initializeServer = (cwd, traceFile) => new Promise((resolve, reject) => {
  const env = { ...process.env, CHEMX_IMPORT_TRACE: traceFile };
  const child = spawn(process.execPath, ['--import', TRACER_PATH, CLI_PATH, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, killSignal: 'SIGKILL' });
  let stdout = '';
  child.on('close', () => reject(new Error(`server closed before replying: ${stdout}`)));
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const hasReply = stdout.includes('\n');
    if (!hasReply) return;
    const modules = readModules(traceFile);
    child.kill('SIGKILL');
    resolve({ reply: JSON.parse(stdout.split('\n')[0]), modules });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
});

test('mcp startup: initialize answers before any tool handler, audit or Babel module loads', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mcp-startup-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"mcpfx","version":"1.0.0"}');
  const traceFile = path.join(project, 'trace.txt');
  const { reply, modules } = await initializeServer(project, traceFile);
  fs.rmSync(project, { recursive: true, force: true });

  assert.strictEqual(reply.id, 1);
  assert.ok(reply.result?.serverInfo, 'initialize returns serverInfo');
  const heavy = localModules(modules).filter((mod) => HEAVY_MODULE.test(mod));
  assert.deepStrictEqual(heavy, [], 'initialize imported tool-stack modules');
  const babel = modules.filter((url) => url.includes('/@babel/'));
  assert.deepStrictEqual(babel, [], 'initialize imported Babel');
});
