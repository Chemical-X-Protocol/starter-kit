// Spec support: spawn the chemx CLI with piped stdio and report its output,
// the set of modules it imported and the user CPU it spent.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = path.resolve(here, '..', 'index.js');
const TRACER_PATH = path.join(here, 'import-trace.mjs');

const readTrace = (traceFile) => {
  const hasTrace = fs.existsSync(traceFile);
  const lines = hasTrace ? fs.readFileSync(traceFile, 'utf8').split('\n').filter(Boolean) : [];
  const cpuLine = lines.find((line) => line.startsWith('cpu-user-ms:'));
  const modules = [...new Set(lines.filter((line) => !line.startsWith('cpu-user-ms:')))];
  const userCpuMs = cpuLine ? Number(cpuLine.slice('cpu-user-ms:'.length)) : NaN;
  return { modules, userCpuMs };
};

export const runCli = (args, { cwd = process.cwd(), env = {}, timeout = 30000 } = {}) => {
  const { traceDir, traceFile, childEnv } = prepareRun(env);
  const result = spawnSync(process.execPath, ['--import', TRACER_PATH, CLI_PATH, ...args], {
    cwd, env: childEnv, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe']
  });
  const trace = readTrace(traceFile);
  fs.rmSync(traceDir, { recursive: true, force: true });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status, signal: result.signal, ...trace };
};

const prepareRun = (env) => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-trace-'));
  const traceFile = path.join(traceDir, 'trace.txt');
  const childEnv = { ...process.env, CHEMX_IMPORT_TRACE: traceFile, ...env };
  delete childEnv.NO_COLOR;
  delete childEnv.FORCE_COLOR;
  return { traceDir, traceFile, childEnv };
};

// Async variant so specs can run several CLI invocations in parallel.
export const runCliAsync = (args, { cwd = process.cwd(), env = {}, timeout = 60000 } = {}) => new Promise((resolve) => {
  const { traceDir, traceFile, childEnv } = prepareRun(env);
  const child = spawn(process.execPath, ['--import', TRACER_PATH, CLI_PATH, ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout, killSignal: 'SIGKILL' });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status, signal) => {
    const trace = readTrace(traceFile);
    fs.rmSync(traceDir, { recursive: true, force: true });
    resolve({ args, stdout, stderr, status, signal, ...trace });
  });
});

export const localModules = (modules) => modules
  .filter((url) => url.startsWith('file:') && url.includes('/cli/') && !url.includes('node_modules'))
  .map((url) => url.slice(url.lastIndexOf('/cli/') + 1));
