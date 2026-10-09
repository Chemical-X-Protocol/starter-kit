/**
 * `chemx conflicts` and `chemx d --conflicts`, plus the boot-time explanation when chemx's own
 * sources cannot load. Like conflicts.js, this imports only node: built-ins and conflicts.js,
 * so cli/index.js can run it before (and without) loading the rest of the CLI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectConflicts, fileConflictHunks } from './conflicts.js';

const HELP_FLAGS = new Set(['--help', '-h', 'help']);
const isHelp = (args) => args.slice(1).some((a) => HELP_FLAGS.has(a));

/** 'conflicts' | 'diff' | null: the commands index.js runs before loading anything else. */
export const wantsEarlyConflictCommand = (args = []) => {
  const [cmd] = args;
  if (isHelp(args)) return null;
  const isConflictsCommand = cmd === 'conflicts';
  if (isConflictsCommand) return 'conflicts';
  const isDiff = cmd === 'd' || cmd === 'diff';
  return isDiff && args.includes('--conflicts') ? 'diff' : null;
};

const sideLines = (label, lines, mark) => [`    ${label}`, ...lines.map((l) => `      ${mark} ${l}`)];

const formatHunk = (h) => [
  `  L${h.start}-${h.end}`,
  ...sideLines(`ours (${h.oursLabel || 'ours'})`, h.ours, '<'),
  ...(h.base ? sideLines('base', h.base, '|') : []),
  ...sideLines(`theirs (${h.theirsLabel || 'theirs'})`, h.theirs, '>')
];

const formatFile = (f) => {
  const head = `${f.path}  [stages: ${f.stages.join(', ')}]`;
  const noMarkers = f.hunks.length === 0;
  if (noMarkers) return [head, '  (no conflict markers in the working file: modify/delete, binary, or already edited; chemx d --conflicts)'];
  return [head, ...f.hunks.flatMap(formatHunk)];
};

/** @returns {number} exit code */
export const runConflictsCli = (args = [], cwd = process.cwd()) => {
  const report = collectConflicts(cwd);
  const isJson = args.includes('--json');
  if (isJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.isRepo ? 0 : 128;
  }
  if (!report.isRepo) {
    process.stderr.write(`not a git repository: ${cwd}\n`);
    return 128;
  }
  const hasNoUnmerged = report.unmerged.length === 0;
  if (hasNoUnmerged) {
    process.stdout.write('No unmerged paths.\n');
    return 0;
  }
  const lines = [`${report.unmerged.length} unmerged path(s):`, ...report.unmerged.flatMap(formatFile)];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
};

/**
 * Combined (--cc) diff of the unmerged paths only, with git's default context.
 *
 * @returns {{ output: string, code: number, error?: string }}
 */
export const conflictDiff = (args = [], cwd = process.cwd()) => {
  const extra = args.filter((a) => !['d', 'diff', '--conflicts'].includes(a));
  const res = spawnSync('git', ['diff', '--no-color', '--diff-filter=U', ...extra], { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  const isFailure = res.status !== 0;
  if (isFailure) return { output: '', code: res.status ?? 1, error: (res.stderr || `git diff failed in ${cwd}`).trim() };
  return { output: res.stdout || 'No unmerged paths.\n', code: 0 };
};

/** @returns {number} exit code */
export const runConflictDiff = (args = [], cwd = process.cwd()) => {
  const res = conflictDiff(args, cwd);
  const hasError = Boolean(res.error);
  if (hasError) process.stderr.write(`${res.error}\n`);
  process.stdout.write(res.output);
  return res.code;
};

const SOURCE_EXT = /\.(?:[cm]?js|json)$/;

const scanDir = (dir, found = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const isSkipped = entry.name === 'node_modules' || entry.name.startsWith('.');
    if (isSkipped) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(abs, found);
    else {
      const isSourceFile = SOURCE_EXT.test(entry.name);
      if (isSourceFile) {
        const hunks = fileConflictHunks(abs);
        const hasHunks = hunks.length > 0;
        if (hasHunks) found.push({ abs, line: hunks[0].start });
      }
    }
  }
  return found;
};

/**
 * When the CLI cannot load, name chemx's own conflicted files instead of a parse stack trace.
 *
 * @param {string} cliDir Directory holding cli/index.js.
 * @returns {string|null} The message, or null when the failure is not a merge conflict.
 */
export const explainLoadFailure = (cliDir) => {
  const kitRoot = path.dirname(cliDir);
  let found = [];
  try { found = scanDir(cliDir); } catch { return null; }
  const isEmpty = found.length === 0;
  if (isEmpty) return null;
  const list = found.map((f) => `${path.relative(kitRoot, f.abs)}:${f.line}`).join(', ');
  return `chemx cannot load: its own source has unmerged conflict markers: ${list}. Resolve them first; chemx conflicts and chemx d --conflicts still work.`;
};
