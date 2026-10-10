// Typecheck stage of heal verify (engine doc, Heal: SAFETY SEQUENCE 6c). Two modes, and the verdict
// always names the mode that ran:
//   sandbox  the piece alone under `chemx typecheck --sandbox` (checkJs, strict, noImplicitAny);
//   scoped   a diagnostic delta for the touched files under the project's own tsconfig (before and after
//            the edit, same tsc), counted only when that tsconfig actually typechecks them.
// A touched file no project tsconfig typechecks (a .js file without allowJs and checkJs, or outside its
// include) gets no scoped check, and the verdict says so instead of passing silently.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSandboxTypecheck } from '../typecheck-sandbox.js';
import { findLocalBin } from '../typecheck-command.js';
import { executeBuild } from '../build/executor.js';
import { parseTypecheckOutput } from '../verify-helpers.js';

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const SANDBOX_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.mts']);
const SCOPED_TIMEOUT_MS = 300_000;

const stripJsonComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const readTsconfig = (root) => {
  const file = path.join(root, 'tsconfig.json');
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf-8')));
  } catch {
    return null; // no or unreadable tsconfig: the project typechecks nothing the scoped mode could compare
  }
};

const includePrefixOf = (pattern) => {
  const star = pattern.search(/[*?{]/);
  const head = star === -1 ? pattern : pattern.slice(0, star);
  return head.replace(/^\.\//, '');
};

const isIncluded = (file, include) => {
  const hasInclude = Array.isArray(include);
  if (!hasInclude) return true;
  return include.map(includePrefixOf).some((prefix) => file === prefix || prefix === '' || file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
};

const isCheckedExtension = (file, options) => {
  const ext = path.extname(file);
  const isJsChecked = JS_EXTENSIONS.has(ext) && Boolean(options.allowJs) && Boolean(options.checkJs);
  return TS_EXTENSIONS.has(ext) || isJsChecked;
};

/**
 * Which of files the project's root tsconfig typechecks (include prefixes, extension and allowJs/checkJs;
 * exclude and project references are not read). Returns { tsconfig, covered, uncovered }.
 */
export const typecheckCoverage = (root, files) => {
  const config = readTsconfig(root);
  const options = config?.compilerOptions ?? {};
  const covered = config ? files.filter((file) => isCheckedExtension(file, options) && isIncluded(file, config.include)) : [];
  return { tsconfig: config ? 'tsconfig.json' : null, covered, uncovered: files.filter((file) => !covered.includes(file)) };
};

const relativeOf = (root, file) => {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  return path.relative(root, absolute).split(path.sep).join('/');
};

/** Diagnostics of the project tsc for the given files: [{ file, code, message }] or { error }. */
export const scopedDiagnostics = async (root, files, { checkerRoot = root } = {}) => {
  const bin = findLocalBin(checkerRoot, 'tsc');
  const isMissingChecker = !bin;
  if (isMissingChecker) return { error: 'no local tsc (node_modules/.bin/tsc)' };
  const execution = await executeBuild(`"${bin}" -p "${path.join(root, 'tsconfig.json')}" --noEmit --pretty false`, root, { timeoutMs: SCOPED_TIMEOUT_MS });
  const isTimedOut = Boolean(execution.timedOut);
  if (isTimedOut) return { error: `tsc timed out after ${SCOPED_TIMEOUT_MS} ms` };
  const wanted = new Set(files);
  const errors = parseTypecheckOutput(execution.stdout, execution.stderr).map((error) => ({ file: relativeOf(root, error.file ?? ''), code: error.code ?? '', message: error.message ?? '' }));
  return { diagnostics: errors.filter((error) => wanted.has(error.file)) };
};

const keyOf = (diagnostic) => `${diagnostic.file}|${diagnostic.code}|${diagnostic.message}`;

/** Diagnostics in after with no same-key counterpart in before (a multiset difference, lines ignored). */
export const introducedDiagnostics = (before, after) => {
  const remaining = new Map();
  for (const diagnostic of before) remaining.set(keyOf(diagnostic), (remaining.get(keyOf(diagnostic)) ?? 0) + 1);
  return after.filter((diagnostic) => {
    const count = remaining.get(keyOf(diagnostic)) ?? 0;
    remaining.set(keyOf(diagnostic), count - 1);
    return count <= 0;
  });
};

/** Sandbox mode for the piece: { mode: 'sandbox', ok, status, detail }. */
export const typecheckPiece = async (pieceText, module, { checkerRoot }) => {
  const ext = path.extname(module);
  const isCheckable = SANDBOX_EXTENSIONS.has(ext);
  if (!isCheckable) return { mode: 'sandbox', ok: true, status: 'not-run', detail: `no sandbox checker for ${ext} pieces` };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-heal-sandbox-'));
  try {
    fs.writeFileSync(path.join(dir, path.basename(module)), pieceText);
    const report = await runSandboxTypecheck(dir, { cwd: checkerRoot, checkJs: true });
    const lines = report.errors.map((error) => `${path.basename(error.file ?? '')}:${error.line ?? ''} ${error.code ?? ''} ${error.message ?? ''}`.trim());
    const isInconclusive = report.status === 'inconclusive';
    const detail = report.executionError ?? (lines.length > 0 ? lines.slice(0, 5).join('; ') : 'checkJs strict: 0 errors');
    return { mode: 'sandbox', ok: report.success || isInconclusive, status: isInconclusive ? 'inconclusive' : report.status, detail };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
