// `chemx install-hooks --host=claude [--scope=project|local] [--dry-run] [--json] [--root=<dir>]
//   [--no-mcp] [--no-statusline] [--git-hook] [--ci] [--native-file-tools=block|warn|allow]`
// The default scope is `project`: the tracked .claude/settings.json, shared by every session and
// worktree of the repo. `--scope=local` writes the untracked .claude/settings.local.json instead.
// Idempotent: a second run reports every file unchanged. Exit codes follow cli/result-status.js:
// 0 all applied, 3 something was refused (foreign entry kept), 1 an input file could not be parsed.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STATUS, combineStatuses, toExitCode } from '../result-status.js';
import { resolveLauncher, KIT_ROOT } from './launcher.js';
import { buildInstallPlan } from './install-hooks-plan.js';
import { applyInstallPlan } from './install-hooks-apply.js';
import { isPolicyMode } from './install-hooks-config.js';

const SUPPORTED_HOSTS = new Set(['claude']);
const SCOPES = new Set(['local', 'project']);

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

const resolveProjectRoot = (explicit, cwd) => {
  if (explicit) return path.resolve(cwd, explicit);
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' });
  const isRepo = result.status === 0 && result.stdout.trim() !== '';
  return isRepo ? result.stdout.trim() : cwd;
};

export const parseInstallArgs = (args, cwd = process.cwd()) => {
  const host = flagValue(args, 'host') ?? (args.includes('--host') ? args[args.indexOf('--host') + 1] : null);
  const scope = flagValue(args, 'scope') ?? 'project';
  const nativeFileTools = flagValue(args, 'native-file-tools');
  const errors = [];
  const isUnsupportedHost = !SUPPORTED_HOSTS.has(host);
  if (isUnsupportedHost) errors.push(`--host must be one of: ${[...SUPPORTED_HOSTS].join(', ')}`);
  const isUnknownScope = !SCOPES.has(scope);
  if (isUnknownScope) errors.push('--scope must be local or project');
  const isUnknownPolicy = nativeFileTools !== null && !isPolicyMode(nativeFileTools);
  if (isUnknownPolicy) errors.push('--native-file-tools must be block, warn or allow');
  return {
    errors,
    host,
    scope,
    projectRoot: resolveProjectRoot(flagValue(args, 'root'), cwd),
    kitRoot: flagValue(args, 'kit') ? path.resolve(cwd, flagValue(args, 'kit')) : KIT_ROOT,
    dryRun: args.includes('--dry-run'),
    isJson: args.includes('--json'),
    options: { mcp: !args.includes('--no-mcp'), statusline: !args.includes('--no-statusline'), gitHook: args.includes('--git-hook'), ci: args.includes('--ci'), nativeFileTools },
  };
};

const actionStatus = (action) => {
  const isError = action.status === 'error';
  if (isError) return STATUS.FAIL;
  const isPartial = action.status === 'refused' || action.hasRefusals;
  return isPartial ? STATUS.INCONCLUSIVE : STATUS.PASS;
};

const WRITABLE = new Set(['create', 'update']);

const pendingSuffix = (action, dryRun) => {
  const isPending = WRITABLE.has(action.status) && !action.written;
  if (!isPending) return '';
  return dryRun ? ' [dry run: not written]' : ' [not written]';
};

const renderText = (report) => {
  const lines = [`chemx install-hooks --host=${report.host} --scope=${report.scope} (${report.status}${report.dryRun ? ', dry run' : ''})`, `  launcher: chemx ${report.version} at ${report.cliPath}`];
  for (const action of report.actions) {
    const where = path.relative(report.projectRoot, action.file) || action.file;
    lines.push(`  ${action.status.padEnd(9)} ${where} (${action.label})${pendingSuffix(action, report.dryRun)}`);
    for (const note of action.notes ?? []) lines.push(`            ${note}`);
    const hasBackup = Boolean(action.backup);
    if (hasBackup) lines.push(`            backup: ${path.relative(report.projectRoot, action.backup)}`);
  }
  return `${lines.join('\n')}\n`;
};

export const runInstallHooks = (parsed, now = Date.now()) => {
  const launcher = resolveLauncher({ kitRoot: parsed.kitRoot, projectRoot: parsed.projectRoot, scope: parsed.scope });
  const plan = buildInstallPlan({ projectRoot: parsed.projectRoot, scope: parsed.scope, launcher, options: parsed.options });
  const results = applyInstallPlan(plan, { projectRoot: parsed.projectRoot, dryRun: parsed.dryRun, now });
  const actions = results.map(({ before, after, ...rest }) => rest);
  const status = combineStatuses(actions.map(actionStatus));
  return { status, host: parsed.host, scope: parsed.scope, dryRun: parsed.dryRun, projectRoot: parsed.projectRoot, version: launcher.version, cliPath: launcher.cliPath, actions };
};

export const runInstallHooksCli = async (args, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) => {
  const parsed = parseInstallArgs(args, cwd);
  const hasErrors = parsed.errors.length > 0;
  if (hasErrors) {
    stderr.write(`${parsed.errors.join('\n')}\nUsage: chemx install-hooks --host=claude [--scope=project|local] [--dry-run] [--json] [--native-file-tools=block|warn|allow]\n`);
    return toExitCode(STATUS.FAIL);
  }
  const report = runInstallHooks(parsed);
  stdout.write(parsed.isJson ? `${JSON.stringify(report)}\n` : renderText(report));
  return toExitCode(report.status);
};
