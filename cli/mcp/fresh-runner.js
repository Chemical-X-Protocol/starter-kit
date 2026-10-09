// Runs one MCP tool call in a one-shot child process that loads the code on disk.
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFreshExit } from './fresh-protocol.js';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fresh-entry.js');
const DEFAULT_TIMEOUT_SECONDS = 600;
const GRACE_MS = 5000;

// The call's own timeout (seconds, as the verify/test/build actions take it) plus a grace period.
export const timeoutMsFor = (toolArgs) => {
  const asked = toolArgs?.params?.timeout ?? toolArgs?.timeout;
  const isUsable = typeof asked === 'number' && asked > 0;
  return (isUsable ? asked : DEFAULT_TIMEOUT_SECONDS) * 1000 + GRACE_MS;
};

// Resolves { kind: 'ok', output } | { kind: 'error', error } | { kind: 'load', message } | { kind: 'timeout' }.
export const createFreshRunner = ({ spawn = nodeSpawn, entry = ENTRY } = {}) => ({ toolName, toolArgs, root, env }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let isDone = false;
  const finish = (result) => {
    if (isDone) return;
    isDone = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    finish({ kind: 'timeout' });
  }, timeoutMsFor(toolArgs));
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (err) => finish({ kind: 'load', message: `cannot start the fresh process: ${err.message}` }));
  child.on('close', (code) => finish(classifyFreshExit({ stdout, stderr, code })));
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ toolName, toolArgs, root }));
});
