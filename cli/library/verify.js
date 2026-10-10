// Verification of one library entry (engine doc, Library: VERIFICATION SPEC): the pure checks of
// verify-checks.js plus the two that need a subprocess, the sandbox typecheck (iii) and the piece spec (iv).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSandboxTypecheck } from '../typecheck-sandbox.js';
import { KIT_ROOT_DIR, readPiece } from './registry.js';
import { checkSchema, RULE_CHECKS, STATIC_CHECKS } from './verify-checks.js';

const SPEC_TIMEOUT_MS = 60_000;
const SANDBOX_EXTENSIONS = new Set(['.js', '.ts']);

const result = (name, ok, detail = '') => ({ name, ok, detail });

/** Verification (iii): the piece, with its optional ambient.d.ts, under `chemx typecheck --sandbox`. */
export const checkTypecheck = async (item, text, cwd = KIT_ROOT_DIR) => {
  const ext = path.extname(item.pieceFile);
  const isCheckable = SANDBOX_EXTENSIONS.has(ext);
  if (!isCheckable) return result('typecheck', true, `skipped: ${ext} pieces have no sandbox checker yet`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-library-sandbox-'));
  try {
    fs.writeFileSync(path.join(dir, `piece${ext}`), text);
    const ambient = path.join(item.dir, 'ambient.d.ts');
    const hasAmbient = fs.existsSync(ambient);
    if (hasAmbient) fs.copyFileSync(ambient, path.join(dir, 'ambient.d.ts'));
    const report = await runSandboxTypecheck(dir, { cwd, checkJs: true });
    const lines = report.errors.map((error) => `${error.file ?? ''}:${error.line ?? ''} ${error.message ?? ''}`.trim());
    return result('typecheck', report.success, report.executionError ?? lines.slice(0, 3).join('; '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// NODE_TEST_CONTEXT marks a process started by a node:test runner; a nested `node --test` that inherits it
// skips its files and exits 0 without running them, so it is never passed on.
const specEnv = () => {
  const env = { ...process.env, NODE_NO_WARNINGS: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

/** Verification (iv): piece.spec.* passes under node --test. */
export const checkPieceSpec = (item) => {
  const hasSpec = Boolean(item.specFile);
  if (!hasSpec) return result('spec', false, 'no piece.spec.js or piece.spec.ts');
  const run = spawnSync(process.execPath, ['--test', path.join(item.dir, item.specFile)], {
    encoding: 'utf-8', timeout: SPEC_TIMEOUT_MS, env: specEnv()
  });
  const tail = `${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-6).join(' | ');
  return result('spec', run.status === 0, tail);
};

const runChecks = (item, checks, text) => checks.map((check) => check(item, text));

/**
 * Verifies an entry. scope 'rules' runs only the checks a ruleset change can break (what quarantine
 * uses); scope 'all' also runs holes, fp, aliases, the sandbox typecheck and the piece spec.
 * Returns { id, ok, checks, failedRules }.
 */
export const verifyItem = async (item, { scope = 'all', cwd = KIT_ROOT_DIR } = {}) => {
  const schema = checkSchema(item);
  const isUsable = schema.ok && Boolean(item.pieceFile);
  if (!isUsable) return { id: item.id, ok: false, checks: [schema], failedRules: [] };
  const text = readPiece(item);
  const checks = [schema, ...runChecks(item, RULE_CHECKS, text)];
  const isFull = scope === 'all';
  if (isFull) {
    checks.push(...runChecks(item, STATIC_CHECKS, text));
    checks.push(await checkTypecheck(item, text, cwd));
    checks.push(checkPieceSpec(item));
  }
  const auditCheck = checks.find((check) => check.name === 'audit');
  return { id: item.id, ok: checks.every((check) => check.ok), checks, failedRules: auditCheck?.rules ?? [] };
};

export const verifyLibrary = async (items, options) => {
  const outcomes = [];
  for (const item of items) outcomes.push(await verifyItem(item, options));
  return outcomes;
};
