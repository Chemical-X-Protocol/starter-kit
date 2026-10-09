// `chemx typecheck --sandbox <dir>`: typecheck a directory of loose JS/TS pieces under a strict
// temporary tsconfig (checkJs on, noImplicitAny), without touching the project's own tsconfig.
// Used to prove generated or library pieces are fully typed before they are adopted.
// The checker is the local tsc, found through findLocalBin (never npx).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STATUS } from './result-status.js';
import { findLocalBin } from './typecheck-command.js';
import { executeBuild } from './build/executor.js';
import { parseTypecheckOutput } from './verify-helpers.js';

export const SANDBOX_REASONS = Object.freeze({
  CHECKER_MISSING: 'CHECKER_MISSING',
  SANDBOX_MISSING: 'SANDBOX_MISSING',
  SANDBOX_EMPTY: 'SANDBOX_EMPTY'
});

const PIECE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);

const isPieceFile = (name) => PIECE_EXTENSIONS.has(path.extname(name)) && !name.endsWith('.d.ts');

const hasPieces = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.some((entry) => (entry.isDirectory() ? hasPieces(path.join(dir, entry.name)) : isPieceFile(entry.name)));
};

export const buildSandboxTsconfig = (sandboxDir, { checkJs = true, typeRoots = [] } = {}) => ({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    allowJs: true,
    checkJs,
    strict: true,
    noImplicitAny: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots,
    types: ['node']
  },
  include: [path.join(sandboxDir, '**/*')]
});

const quote = (value) => `"${value}"`;

const inconclusive = (reason, message) => ({ command: null, checker: 'tsc', status: STATUS.INCONCLUSIVE, reason, message });

const writeTempTsconfig = (config) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sandbox-'));
  const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
  fs.writeFileSync(tsconfigPath, JSON.stringify(config, null, 2));
  return { tmpDir, tsconfigPath };
};

// Returns { command, checker, tsconfigPath, cleanup } when runnable, else { command: null, status, reason, message }.
export const planSandboxTypecheck = (sandboxArg, { cwd = process.cwd(), checkJs = true } = {}) => {
  const sandboxDir = path.resolve(cwd, sandboxArg);
  const isDirectory = fs.existsSync(sandboxDir) && fs.statSync(sandboxDir).isDirectory();
  if (!isDirectory) return inconclusive(SANDBOX_REASONS.SANDBOX_MISSING, `sandbox directory not found: ${sandboxArg}`);
  if (!hasPieces(sandboxDir)) return inconclusive(SANDBOX_REASONS.SANDBOX_EMPTY, `no .js/.ts pieces under ${sandboxArg}`);

  const bin = findLocalBin(cwd, 'tsc');
  if (!bin) return inconclusive(SANDBOX_REASONS.CHECKER_MISSING, 'sandbox typecheck needs node_modules/.bin/tsc; install typescript');

  const typesDir = path.join(path.dirname(path.dirname(path.dirname(bin))), 'node_modules', '@types');
  const typeRoots = fs.existsSync(typesDir) ? [typesDir] : [];
  const { tmpDir, tsconfigPath } = writeTempTsconfig(buildSandboxTsconfig(sandboxDir, { checkJs, typeRoots }));
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  return { command: `${quote(bin)} -p ${quote(tsconfigPath)} --pretty false`, checker: 'tsc', tsconfigPath, cleanup };
};

const sandboxReport = (fields) => ({
  status: STATUS.FAIL, success: false, reason: null, exitCode: 1, command: null, checker: 'tsc', durationMs: 0, errorCount: 0, executionError: null, errors: [], ...fields
});

// Runs the sandbox check and returns a report in the same shape as `chemx typecheck`.
export const runSandboxTypecheck = async (sandboxArg, { cwd = process.cwd(), checkJs = true, timeoutMs = null, raw = false } = {}) => {
  const plan = planSandboxTypecheck(sandboxArg, { cwd, checkJs });
  if (!plan.command) return sandboxReport({ status: plan.status, reason: plan.reason, executionError: plan.message, checker: plan.checker });
  try {
    const execution = await executeBuild(plan.command, cwd, { raw, timeoutMs });
    const errors = parseTypecheckOutput(execution.stdout, execution.stderr);
    const isClean = execution.exitCode === 0 && errors.length === 0;
    const status = isClean ? STATUS.PASS : STATUS.FAIL;
    const hasBareFailure = !isClean && errors.length === 0;
    const executionError = hasBareFailure ? `${execution.stderr}\n${execution.stdout}`.trim().split('\n')[0] : null;
    return sandboxReport({ status: execution.timedOut ? STATUS.INCONCLUSIVE : status, success: isClean, exitCode: execution.exitCode, command: plan.command, durationMs: execution.durationMs, errorCount: errors.length, executionError, errors });
  } finally {
    plan.cleanup();
  }
};
