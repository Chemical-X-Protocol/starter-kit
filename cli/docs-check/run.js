/**
 * `chemx docs check [files/dirs...] [--exclude=<path fragment>]`
 * Reads markdown, never executes anything, exits 1 when a named command does not exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractInvocations } from './extract.js';
import { resolveInvocation } from './resolve.js';

const SKIPPED_DIRS = new Set(['node_modules', '.git', '.chemx']);
const DEFAULT_TARGETS = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'STANDARDS.md', 'docs'];
const MARKDOWN_FILE = /\.md$/i;
// Dated design history quotes commands as they were when written, including commands not built yet.
// Skipped only when no paths are given; naming a path checks it.
export const DEFAULT_EXCLUDES = ['docs/superpowers/plans/', 'docs/superpowers/reviews/', 'docs/superpowers/specs/'];

const walkMarkdown = (target) => {
  const stat = fs.statSync(target);
  if (stat.isFile()) return MARKDOWN_FILE.test(target) ? [target] : [];
  const entries = fs.readdirSync(target, { withFileTypes: true });
  const visible = entries.filter((entry) => !SKIPPED_DIRS.has(entry.name));
  return visible.flatMap((entry) => walkMarkdown(path.join(target, entry.name)));
};

export const collectMarkdownFiles = (targets, cwd, excludes = []) => {
  const existing = targets.map((t) => path.resolve(cwd, t)).filter((t) => fs.existsSync(t));
  const files = existing.flatMap(walkMarkdown);
  const isExcluded = (file) => excludes.some((fragment) => file.split(path.sep).join('/').includes(fragment));
  return [...new Set(files)].filter((file) => !isExcluded(file)).sort();
};

/** Explicit targets that do not exist; a typo must fail, not pass on zero files. */
export const findMissingTargets = (targets, cwd) => targets.filter((t) => !fs.existsSync(path.resolve(cwd, t)));

/** @returns {{files:number, checked:number, failures:Array<{file:string,line:number,text:string,reason:string}>}} */
export const checkMarkdownFiles = (files, cwd) => {
  const failures = [];
  let checked = 0;
  for (const file of files) {
    const invocations = extractInvocations(fs.readFileSync(file, 'utf8'));
    checked += invocations.length;
    for (const invocation of invocations) {
      const reason = resolveInvocation(invocation);
      const rel = path.relative(cwd, file);
      if (reason) failures.push({ file: rel, line: invocation.line, text: invocation.text, reason });
    }
  }
  return { files: files.length, checked, failures };
};

const parseDocsArgs = (args) => {
  const excludes = args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice('--exclude='.length));
  const targets = args.filter((a) => !a.startsWith('-'));
  return { excludes, targets, isJson: args.includes('--json') };
};

export const formatDocsReport = (result) => {
  const rows = result.failures.map((f) => `${f.file}:${f.line}  ${f.text}\n    ${f.reason}`);
  const verdict = result.failures.length === 0 ? 'ok' : `${result.failures.length} failed`;
  const summary = `docs check: ${verdict}. ${result.checked} invocation(s) in ${result.files} file(s); command names, and --flags against each command's schema. Pass-through commands (test, build, lint, typecheck) are not flag-checked; team and git wrappers only for typos close to a chemx flag. Short flags and argument values on those are not checked.`;
  return `${[...rows, summary].join('\n')}\n`;
};

export const runDocsCli = (args, cwd = process.cwd()) => {
  const [subcommand, ...rest] = args;
  const isCheck = subcommand === 'check';
  if (!isCheck) {
    process.stderr.write('Usage: chemx docs check [files/dirs...] [--exclude=<path fragment>] [--json]\n');
    return { code: 1 };
  }
  const { excludes, targets, isJson } = parseDocsArgs(rest);
  const isDefault = targets.length === 0;
  const missing = findMissingTargets(targets, cwd);
  for (const target of missing) process.stderr.write(`no such path: ${target}\n`);
  const hasMissing = missing.length > 0;
  if (hasMissing) return { code: 1 };
  const scanTargets = isDefault ? DEFAULT_TARGETS : targets;
  const scanExcludes = isDefault ? [...DEFAULT_EXCLUDES, ...excludes] : excludes;
  const files = collectMarkdownFiles(scanTargets, cwd, scanExcludes);
  const isEmpty = files.length === 0;
  if (isEmpty) {
    process.stderr.write('docs check: no markdown files found, so nothing was checked. Pass a file or directory that has .md files.\n');
    return { code: 1 };
  }
  const result = checkMarkdownFiles(files, cwd);
  process.stdout.write(isJson ? `${JSON.stringify(result)}\n` : formatDocsReport(result));
  return { code: result.failures.length === 0 ? 0 : 1 };
};
