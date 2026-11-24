// `chemx typecheck`: run the project's type checker silently and report a tri-state verdict.
import path from 'node:path';
import { executeBuild } from './build/executor.js';
import { findProjectRoot } from './build/detector.js';
import { ANSI } from './theme.js';
import { STATUS, toExitCode, isPass, isInconclusive } from './result-status.js';
import { parseCliArgs, describeArgErrors, parseTimeoutSeconds } from './cli-args.js';
import { planTypecheck } from './typecheck-command.js';
import { runSandboxTypecheck } from './typecheck-sandbox.js';
import { parseTypecheckOutput, checkNodeModules } from './verify-helpers.js';
import { formatAgentJson } from './agent-json.js';
import { workspaceAt, emitWorkspace, rootOrAllPackages } from './workspace-run.js';
import { runInLine, lineOptionsOf } from './job-line-run.js';
import { sharedRunField, sharedRunNote, queuedFields } from './job-line-text.js';

const TYPECHECK_ARGS = {
  booleans: { '--json': 'json', '--raw': 'raw', '--checkjs': 'checkjs', '--no-checkjs': 'noCheckjs', '--all-packages': 'allPackages', '--help': 'help', '-h': 'help' },
  values: { '--timeout': 'timeout', '--sandbox': 'sandbox' }
};

const TYPECHECK_HELP = [
  `${ANSI.BOLD}USAGE${ANSI.RESET}`,
  '  chemx typecheck [path...] [options] [-- <command>]',
  '',
  '  Optional paths (files or folders) filter the diagnostics: the checker still runs over the whole',
  '  project, but only errors under those paths are reported and decide the verdict.',
  '',
  '  Uses the "typecheck" script when present, else the local vue-tsc / svelte-check / tsc.',
  '  A missing checker is reported as inconclusive (exit 3), never as clean.',
  '',
  `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
  '  --timeout=<seconds>      Stop the check after this long (result: inconclusive)',
  '  --all-packages           At a monorepo root: check every workspace package (else refused)',
  '  --sandbox=<dir>          Check a directory of loose JS/TS pieces under a temp strict tsconfig (checkJs, noImplicitAny)',
  '  --checkjs                With --sandbox: check JS files (the default for a sandbox)',
  '  --no-checkjs             With --sandbox: skip JS files and check only TS (wins over --checkjs)',
  '  --json                   Output structured diagnostics as JSON',
  '  --raw                    Stream the checker output as it runs',
  '  -h, --help               Show this help message',
  '',
  `${ANSI.BOLD}THE LINE${ANSI.RESET}`,
  '  A typecheck is heavy work: it waits its turn in the line the full test run and the build share',
  '  (chemx test --help), and a caller asking for the same check while it waits shares its run.',
  ''
].join('\n');

const typecheckBody = (report) => {
  if (isPass(report.status)) {
    return `  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}TypeScript typecheck clean${ANSI.RESET} ${ANSI.DIM}(${report.durationMs}ms, ${report.command})${ANSI.RESET}\n`;
  }
  if (isInconclusive(report.status)) {
    return `  ${ANSI.YELLOW}?${ANSI.RESET} ${ANSI.BOLD}Typecheck inconclusive: ${report.reason}${ANSI.RESET} ${ANSI.DIM}(${report.executionError || report.detail})${ANSI.RESET}\n`;
  }
  const hasNoDiagnostics = report.errors.length === 0;
  if (hasNoDiagnostics) {
    return `\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Execution Error:${ANSI.RESET} ${report.executionError}\n\n`;
  }
  const scope = report.filter ? ` under ${report.filter.join(', ')}` : '';
  const out = [`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Errors (${report.errorCount} found${scope})${ANSI.RESET}`];
  const byFile = countByFile(report.errors);
  for (const [file, count] of byFile.slice(0, MAX_FILES)) out.push(`    ${ANSI.CYAN}${file}${ANSI.RESET} ${ANSI.DIM}(${count})${ANSI.RESET}`);
  const hasMoreFiles = byFile.length > MAX_FILES;
  if (hasMoreFiles) out.push(`    ${ANSI.DIM}...${byFile.length - MAX_FILES} more files${ANSI.RESET}`);
  for (const err of report.errors.slice(0, MAX_DIAGNOSTICS)) out.push(`    ${ANSI.CYAN}${err.file}:${err.line}:${err.column}${ANSI.RESET} [${err.code}] ${err.message}`);
  const hasMore = report.errors.length > MAX_DIAGNOSTICS;
  if (hasMore) out.push(`    ${ANSI.DIM}...${report.errors.length - MAX_DIAGNOSTICS} more${ANSI.RESET}`);
  const hiddenOutside = report.outsideFilterCount > 0;
  if (hiddenOutside) out.push(`    ${ANSI.DIM}(${report.outsideFilterCount} more errors outside the filter)${ANSI.RESET}`);
  return `${out.join('\n')}\n\n`;
};

const MAX_FILES = 20;
const MAX_DIAGNOSTICS = 30;

const countByFile = (errors) => {
  const counts = new Map();
  for (const err of errors) counts.set(err.file, (counts.get(err.file) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const toFilterPrefix = (base, cwd, raw) => {
  const relative = path.relative(cwd, path.resolve(base, raw)).split(path.sep).join('/');
  return relative.replace(/\/+$/, '');
};

const isUnderFilter = (file, prefixes) => {
  const normalized = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return prefixes.some((prefix) => prefix === '' || normalized === prefix || normalized.startsWith(`${prefix}/`));
};

const formatTypecheckReport = (report) => `${typecheckBody(report)}${sharedRunNote(report)}`;

const emit = (report, { isJson, isCli, shouldPrint }) => {
  if (shouldPrint) process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : formatTypecheckReport(report));
  if (isCli) process.exit(toExitCode(report.status));
  return report;
};

const earlyReport = (status, command, fields) => ({
  status, success: status === STATUS.PASS, reason: null, exitCode: 1, command, durationMs: 0, errorCount: 0, executionError: null, errors: [], ...fields
});

const firstErrorLine = (execution) => {
  const rawLines = `${execution.stderr}\n${execution.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return rawLines.find((l) => /error|not found|cannot find/i.test(l)) || rawLines[0] || `Command exited with code ${execution.exitCode}`;
};

const typecheckStatusOf = (execution, errors) => {
  const hasTimedOut = Boolean(execution.timedOut);
  if (hasTimedOut) return STATUS.INCONCLUSIVE;
  const isClean = execution.exitCode === 0 && errors.length === 0;
  return isClean ? STATUS.PASS : STATUS.FAIL;
};

const describeExecutionError = (execution, hasBareFailure, timeoutMs) => {
  const hasTimedOut = Boolean(execution.timedOut);
  if (hasTimedOut) return `Timed out after ${timeoutMs}ms`;
  return hasBareFailure ? firstErrorLine(execution) : null;
};

export const runTypecheckAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const parsed = parseCliArgs(rawArgs, TYPECHECK_ARGS);
  const isJson = Boolean(parsed.flags.json) || options.json === true;
  const output = { isJson, isCli, shouldPrint: options.print !== false };
  const isHelpRequested = Boolean(parsed.flags.help);
  if (isHelpRequested) {
    if (output.shouldPrint) process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : TYPECHECK_HELP);
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const customCmd = parsed.command || options.command;
  const argError = describeArgErrors(parsed, 'typecheck');
  if (argError) return emit(earlyReport(STATUS.FAIL, customCmd || 'typecheck', { reason: 'USAGE', executionError: argError }), output);

  const cwd = findProjectRoot(options.cwd || process.cwd());
  const isSandboxRun = Boolean(parsed.values.sandbox);
  if (isSandboxRun) {
    const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? null;
    const sandboxReport = await runSandboxTypecheck(parsed.values.sandbox, { cwd, timeoutMs, raw: Boolean(parsed.flags.raw), checkJs: !parsed.flags.noCheckjs });
    return emit(sandboxReport, output);
  }
  const workspace = options.inWorkspace || customCmd ? null : workspaceAt(cwd);
  if (workspace) {
    const allPackages = Boolean(parsed.flags.allPackages || options.allPackages);
    const timeoutArgs = parsed.values.timeout ? [`--timeout=${parsed.values.timeout}`] : [];
    const queueing = { returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand };
    const runInPackage = (pkg) => runTypecheckAudit(timeoutArgs, false, { timeoutMs: options.timeoutMs, cwd: pkg.dir, print: false, json: true, inWorkspace: true, ...queueing });
    return emitWorkspace(await rootOrAllPackages(workspace, 'typecheck', allPackages, runInPackage), output, formatTypecheckReport);
  }
  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('typechecking');
    const missingDeps = { file: 'package.json', line: 1, column: 1, code: 'MISSING_NODE_MODULES', message: friendlyMsg };
    return emit(earlyReport(STATUS.FAIL, customCmd || 'typecheck', { errorCount: 1, executionError: friendlyMsg, errors: [missingDeps] }), output);
  }

  const plan = planTypecheck(customCmd, cwd);
  const cannotRun = !plan.command;
  if (cannotRun) return emit(earlyReport(plan.status, plan.checker || 'typecheck', { reason: plan.reason, executionError: plan.message }), output);

  const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? null;
  const isRaw = Boolean(parsed.flags.raw) || options.raw === true;
  const lineRequest = { kind: 'typecheck', cwd, keyCommand: plan.command, raw: isRaw, returnQueuedAfterMs: options.returnQueuedAfterMs, retryCommand: options.retryCommand, ...lineOptionsOf(options) };
  const line = await runInLine(lineRequest, () => executeBuild(plan.command, cwd, { raw: isRaw, timeoutMs }));
  const isQueued = line.queued === true;
  if (isQueued) return emit(earlyReport(STATUS.INCONCLUSIVE, plan.command, queuedFields(line, 'typecheck')), output);
  const { execution } = line;
  const allErrors = parseTypecheckOutput(execution.stdout, execution.stderr);
  const hasFilter = parsed.positionals.length > 0;
  const prefixes = parsed.positionals.map((p) => toFilterPrefix(options.cwd || process.cwd(), cwd, p));
  const errors = hasFilter ? allErrors.filter((e) => isUnderFilter(e.file, prefixes)) : allErrors;
  const outsideFilterCount = allErrors.length - errors.length;
  // Filtered-out diagnostics are not this caller's failures: a non-zero exit explained by them is a pass for the scope.
  const isScopedClean = hasFilter && errors.length === 0 && allErrors.length > 0 && !execution.timedOut;
  const status = isScopedClean ? STATUS.PASS : typecheckStatusOf(execution, errors);
  const hasBareFailure = status === STATUS.FAIL && errors.length === 0;

  // A `script:<name>` checker repeats `<pm> run <name>` from command; leave it out so the
  // agent payload stays no larger than the raw checker output (G5 byte budget).
  const isScriptChecker = String(plan.checker || '').startsWith('script:');
  const report = {
    status,
    success: status === STATUS.PASS,
    reason: execution.timedOut ? 'STEP_TIMEOUT' : null,
    exitCode: execution.exitCode,
    command: plan.command,
    checker: isScriptChecker ? null : plan.checker,
    durationMs: execution.durationMs,
    errorCount: errors.length,
    executionError: describeExecutionError(execution, hasBareFailure, timeoutMs),
    errors,
    filter: hasFilter ? prefixes.map((p) => p || '.') : null,
    outsideFilterCount: hasFilter ? outsideFilterCount : null,
    ...sharedRunField(line.shared)
  };
  return emit(report, output);
};
