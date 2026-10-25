// `php -l` over a repo's PHP files: the syntax gate `chemx verify` runs in a repo with its own
// tests/run-tests.mjs harness runner (task #6770, the WordPress plugins). Only the syntax check is
// here; PHP audit rules belong to cli/php/ and the PHP audit epic.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listChangedFiles } from './test-changes.js';
import { STATUS } from './result-status.js';
import { SKIPPED } from './verify-steps.js';

export const PHP_NOT_FOUND = 'PHP_NOT_FOUND';
const PHP_FILE = /\.php$/i;
const SKIPPED_DIRS = new Set(['.git', '.chemx', 'node_modules', 'vendor']);
const VENDORED_SEGMENTS = ['node_modules', 'vendor'];
const LINT_TIMEOUT_MS = 30 * 1000;
const ERROR_LIMIT = 5;
// `-d display_errors=1 -d log_errors=0` makes php print the error once, on stdout, whatever php.ini says.
const PHP_FLAGS = ['-d', 'display_errors=1', '-d', 'log_errors=0', '-d', 'html_errors=0', '-l'];
const PARSE_ERROR = /(?:Parse|Fatal) error:\s+(.+?) in (.+?) on line (\d+)/;

const toPosix = (value) => value.split(path.sep).join('/');

// A directory below the root with a `.git` of its own is another repository (a submodule): its files are not ours.
const isWalked = (abs, name) => {
  const isSkippedName = SKIPPED_DIRS.has(name);
  const isNestedRepo = fs.existsSync(path.join(abs, '.git'));
  return !isSkippedName && !isNestedRepo;
};

const walk = (root, dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const abs = path.join(dir, entry.name);
  if (entry.isDirectory()) return isWalked(abs, entry.name) ? walk(root, abs) : [];
  return PHP_FILE.test(entry.name) ? [toPosix(path.relative(root, abs))] : [];
});

// Every .php file below the root (root-relative, sorted), leaving out vendor/, node_modules/, dot
// dirs of the tooling and nested repositories.
export const listPhpFiles = (root) => walk(root, root).sort();

const isVendored = (relPath) => relPath.split('/').some((segment) => VENDORED_SEGMENTS.includes(segment));

// The .php files that differ from `base` (HEAD when null) in the working tree, new ones included, deleted ones not.
export const changedPhpFiles = (root, base = null) => {
  const listing = listChangedFiles(root, { base });
  if (!listing.ok) return { ok: false, error: listing.error };
  const files = listing.files
    .filter((file) => file.status !== 'D' && PHP_FILE.test(file.path) && !isVendored(file.path))
    .map((file) => file.path);
  return { ok: true, base: listing.base, files };
};

// { file, line, message } from php's answer (`Parse error: <message> in <file> on line <n>`), or null.
export const parseLintOutput = (output = '') => {
  const match = PARSE_ERROR.exec(String(output));
  if (!match) return null;
  return { file: match[2], line: Number(match[3]), message: match[1] };
};

const firstLine = (text) => String(text).split('\n').map((line) => line.trim()).find(Boolean) ?? '';

// One file through `php -l`: null when it is clean, an error entry when it is not, { missing: true } without php.
const lintFile = (php, root, rel) => {
  const run = spawnSync(php, [...PHP_FLAGS, rel], { cwd: root, encoding: 'utf8', timeout: LINT_TIMEOUT_MS });
  const isMissing = run.error?.code === 'ENOENT';
  if (isMissing) return { missing: true };
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const isTimedOut = run.error?.code === 'ETIMEDOUT';
  if (isTimedOut) return { file: rel, line: 0, message: `php -l timed out after ${LINT_TIMEOUT_MS / 1000}s` };
  const isClean = run.status === 0;
  if (isClean) return null;
  const parsed = parseLintOutput(output);
  if (!parsed) return { file: rel, line: 0, message: firstLine(output) || `php -l exited ${run.status}` };
  return { ...parsed, file: rel };
};

const sectionOf = (fields) => ({ command: 'php -l', reason: null, note: null, errors: [], ...fields });

const skippedSection = (note) => sectionOf({ status: SKIPPED, success: true, reason: PHP_NOT_FOUND, checked: 0, failed: 0, scope: null, note });

// Which files to lint and why: { files, scope, note }.
const selectFiles = (root, { all, base }) => {
  if (all) return { files: listPhpFiles(root), scope: 'all PHP files', note: null };
  const changed = changedPhpFiles(root, base);
  if (changed.ok) return { files: changed.files, scope: `changed vs ${changed.base}`, note: null };
  return { files: listPhpFiles(root), scope: 'all PHP files', note: `${changed.error}; linted every PHP file` };
};

// The gate: `php -l` on the changed PHP files (every PHP file with `all`, or when git cannot say what changed).
// php missing from PATH is a skip, never a pass or a failure. php (the binary name) is injectable for specs.
export const lintPhp = (root, { all = false, base = null, php = 'php' } = {}) => {
  const selected = selectFiles(root, { all, base });
  const errors = [];
  let checked = 0;
  for (const rel of selected.files) {
    const result = lintFile(php, root, rel);
    if (result?.missing) return skippedSection('php is not on PATH, so php -l did not run');
    checked += 1;
    if (result) errors.push(result);
  }
  const status = errors.length > 0 ? STATUS.FAIL : STATUS.PASS;
  return sectionOf({ status, success: status === STATUS.PASS, checked, failed: errors.length, scope: selected.scope, note: selected.note, errors: errors.slice(0, ERROR_LIMIT) });
};
