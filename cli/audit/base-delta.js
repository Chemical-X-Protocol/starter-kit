/**
 * Delta gate against a base ref (#6091): each changed source file's working-tree content
 * is audited against the same file at the base, and the gate fails only when a rule's
 * violation count rises in a file, at any severity (gate-delta.js, the rule the pre-commit
 * hook and the ratchet apply). Hazards the base already has never count, so a change that
 * fixes one rule is not held red by other rules the repo-wide ratchet fails on.
 *
 * The base is merge-base(<ref>, HEAD) when there is one, the same starting point
 * `verify --changed --base=<ref>` uses to list changed files; otherwise <ref> itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config/index.js';
import { isSourceFilePath } from '../audit-preflight-git.js';
import { evaluateChanges, formatSites } from './gate-delta.js';
import { gitText, parseNameStatus, changeFromContents } from './staged-delta.js';

const DIFF_ARGS = ['diff', '--name-status', '-z', '-M', '--diff-filter=ACMR', '--relative'];

/** { label, rev } for an existing commit-ish, null when `baseRef` names none. A leading `-` is never a ref. */
const resolveBase = (cwd, baseRef) => {
  const isOptionLike = typeof baseRef !== 'string' || baseRef === '' || baseRef.startsWith('-');
  if (isOptionLike) return null;
  const commit = gitText(cwd, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  const isMissing = commit === null;
  if (isMissing) return null;
  const mergeBase = gitText(cwd, ['merge-base', baseRef, 'HEAD']);
  return { label: baseRef, rev: (mergeBase ?? commit).trim() };
};

/** Untracked, non-ignored source files: new content in the working tree that git diff does not list. */
const listUntrackedSources = (cwd) =>
  (gitText(cwd, ['ls-files', '--others', '--exclude-standard', '-z']) ?? '')
    .split('\0')
    .filter((file) => file !== '' && isSourceFilePath(file))
    .map((file) => ({ file, basePath: null, isRename: false }));

/** Changed source files vs `rev` as { file, basePath, isRename }, paths relative to `cwd`; a file is listed once. */
const listBaseSources = (cwd, rev) => {
  const tracked = parseNameStatus(gitText(cwd, [...DIFF_ARGS, rev, '--']) ?? '');
  const seen = new Set(tracked.map((entry) => entry.file));
  return [...tracked, ...listUntrackedSources(cwd).filter((entry) => !seen.has(entry.file))];
};

const readWorkingTree = (cwd, file) => {
  const absPath = path.join(cwd, file);
  const isFile = fs.statSync(absPath, { throwIfNoEntry: false })?.isFile() === true;
  return isFile ? fs.readFileSync(absPath, 'utf-8') : null;
};

const toChange = (cwd, rev, entry, config) => {
  const afterText = readWorkingTree(cwd, entry.file);
  const isReadable = afterText !== null;
  if (!isReadable) return null;
  const baseText = entry.basePath ? gitText(cwd, ['show', `${rev}:./${entry.basePath}`]) ?? '' : '';
  return changeFromContents(cwd, entry, { baseText, afterText, config });
};

/**
 * Per-rule delta of the working tree against `baseRef`. `options.config` replaces the project
 * config loaded from `cwd` and `rawArgs` (verify passes the one it already holds).
 *
 * @returns {{ isPassing: boolean, base: string, rev?: string, checked: number, files: object[], baseMissing?: boolean, error?: string }}
 * An unknown ref never throws and never passes: it returns baseMissing with isPassing false, so
 * a typo cannot turn the gate green.
 */
export const evaluateBaseDelta = (cwd = process.cwd(), baseRef, rawArgs = [], options = {}) => {
  const resolved = resolveBase(cwd, baseRef);
  const isMissing = resolved === null;
  if (isMissing) return { isPassing: false, base: baseRef ?? null, checked: 0, files: [], baseMissing: true, error: `unknown base revision "${baseRef ?? ''}"` };
  const config = options.config ?? loadProjectConfig(cwd, rawArgs);
  const entries = listBaseSources(cwd, resolved.rev);
  const changes = entries.map((entry) => toChange(cwd, resolved.rev, entry, config)).filter(Boolean);
  return { ...evaluateChanges(changes), base: resolved.label, rev: resolved.rev, checked: changes.length };
};

/** The delta as the compact block `verify --json` carries: rising rules and one `RULE@file:line [SEVERITY]` per new hazard. */
export const summarizeBaseDelta = (delta) => ({
  base: delta.base,
  passing: delta.isPassing,
  checked: delta.checked,
  ...(delta.error ? { error: delta.error } : {}),
  files: delta.files.map((entry) => ({
    file: entry.file,
    ...(entry.renamedFrom ? { renamedFrom: entry.renamedFrom } : {}),
    increases: entry.increases.map(({ rule, severity, before, after }) => ({ rule, severity, before, after })),
    sites: formatSites(entry)
  }))
});
