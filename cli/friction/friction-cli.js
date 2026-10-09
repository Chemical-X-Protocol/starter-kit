// `chemx friction [summary|add "<note>"|export --to=<file.md>] [--json] [--root=<dir>]`
// `chemx friction --usage <transcript dir|file...> [--json]`
// Guard denials and bypasses arrive automatically from the hooks; this command reads them back,
// records manual notes and appends new entries to a Markdown friction log.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STATUS, toExitCode } from '../result-status.js';
import { appendFriction, readFriction } from './friction-log.js';
import { exportFriction, summariseFriction } from './friction-export.js';
import { buildUsageReport, renderUsageReport } from './usage-report.js';

const USAGE = 'Usage: chemx friction [summary | add "<note>" | export --to=<file.md> [--dry-run]] [--json]\n       chemx friction --usage <transcript dir|file...> [--json]\n';

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const positionals = (args) => args.filter((arg) => !arg.startsWith('--'));

const resolveRoot = (args, cwd) => {
  const explicit = flagValue(args, 'root');
  if (explicit) return path.resolve(cwd, explicit);
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' });
  return result.status === 0 ? result.stdout.trim() : cwd;
};

const renderSummary = (file, summary, malformed) => {
  const top = (bucket) => Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => `${key} ${count}`).join(', ') || 'none';
  return [
    `chemx friction: ${summary.total} entries in ${file}${malformed ? ` (${malformed} malformed lines skipped)` : ''}`,
    `  by kind:   ${top(summary.byKind)}`,
    `  by rule:   ${top(summary.byRule)}`,
    `  bypasses:  ${top(summary.byReason)}`,
  ].join('\n') + '\n';
};

const runUsage = (args, write) => {
  const targets = positionals(args);
  const hasTargets = targets.length > 0;
  if (!hasTargets) { write(USAGE); return STATUS.FAIL; }
  const report = buildUsageReport(targets);
  write(args.includes('--json') ? `${JSON.stringify(report)}\n` : renderUsageReport(report));
  return report.files > 0 ? STATUS.PASS : STATUS.INCONCLUSIVE;
};

export const runFrictionCli = async (args, { stdout = process.stdout, cwd = process.cwd(), env = process.env } = {}) => {
  const write = (text) => stdout.write(text);
  const isUsage = args.includes('--usage');
  if (isUsage) return toExitCode(runUsage(args.filter((arg) => arg !== '--usage'), write));
  const [action = 'summary', ...rest] = positionals(args);
  const root = resolveRoot(args, cwd);
  const isJson = args.includes('--json');
  if (action === 'add') {
    const note = rest.join(' ').trim();
    if (!note) { write(USAGE); return toExitCode(STATUS.FAIL); }
    const appended = appendFriction(root, { kind: 'note', note }, env);
    write(isJson ? `${JSON.stringify(appended)}\n` : `${appended.ok ? 'logged' : `not logged (${appended.error})`}: ${appended.file}\n`);
    return toExitCode(appended.ok ? STATUS.PASS : STATUS.FAIL);
  }
  const { file, entries, malformed } = readFriction(root, env);
  if (action === 'export') {
    const target = flagValue(args, 'to');
    if (!target) { write(USAGE); return toExitCode(STATUS.FAIL); }
    const exported = exportFriction({ root, entries, target: path.resolve(cwd, target), dryRun: args.includes('--dry-run') });
    write(isJson ? `${JSON.stringify(exported)}\n` : `${exported.appended} of ${exported.pending} new entries appended to ${target}\n`);
    return toExitCode(STATUS.PASS);
  }
  const summary = summariseFriction(entries);
  write(isJson ? `${JSON.stringify({ file, malformed, ...summary })}\n` : renderSummary(file, summary, malformed));
  return toExitCode(STATUS.PASS);
};
