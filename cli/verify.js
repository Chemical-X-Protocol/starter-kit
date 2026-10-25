import path from 'node:path';
import { runBuildAudit } from './build.js';
import { findProjectRoot, findProjectRunner } from './build/detector.js';
import { resolveAuditScope } from './audit-scope.js';
import { STATUS, toExitCode } from './result-status.js';
import { parseCliArgs, describeArgErrors, parseTimeoutSeconds } from './cli-args.js';
import { checkNodeModules } from './verify-helpers.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { runTestAudit } from './test-audit.js';
import {
  DEFAULT_STEP_TIMEOUT_MS, SKIPPED, typecheckSection, testsSection, buildSection,
  combineStepStatuses, architecturalWarningFor
} from './verify-steps.js';
import {
  VERIFY_HELP, stepLine, formatTypecheckStep, formatTestStep, testStepIcon, formatBuildStep, createProgress, formatVerdict, isEmptyAllowed, printEarly, verifyBanner
} from './verify-report.js';
import { formatAgentJson } from './agent-json.js';
import { sharedRunNote } from './job-line-text.js';
import { resolveVerifyChanges, testArgsFor, verifyWorkspace, formatVerifyLine } from './verify-changed.js';
import { runAuditStep } from './verify-audit-step.js';
import { runHarnessVerify } from './verify-harness.js';
import { workspaceAt, emitWorkspace } from './workspace-run.js';

export {
  parseCommandFromArgs,
  detectTypecheckCommand,
  detectTestCommand,
  parseTypecheckOutput,
  parseTestOutput
} from './verify-helpers.js';
export { runLintAudit } from './verify-lint.js';
export { runTypecheckAudit } from './typecheck-audit.js';
export { runTestAudit } from './test-audit.js';

const VERIFY_ARGS = {
  booleans: { '--json': 'json', '--build': 'build', '--allow-empty': 'allowEmpty', '--changed': 'changed', '--all-packages': 'allPackages', '--all': 'all', '--help': 'help', '-h': 'help' },
  values: { '--dir': 'dir', '--timeout': 'timeout', '--profile': 'profile', '--base': 'base' }
};

// verify takes no positional arguments; `chemx verify src` must not silently verify everything.
const VERIFY_STRAY_HINT = 'use --dir=<path> to pick a directory';
// --all means "every PHP file" and only a repo with its own harness runner has php -l to run.
const ALL_NEEDS_RUNNER = '--all lints every PHP file in a repo with its own tests/run-tests.mjs harness runner; this project has none (--all-packages verifies every workspace package)';

const finish = (summary, status, { isCli }) => {
  if (isCli) process.exit(toExitCode(status));
  return summary;
};

export const runProjectVerify = async (rawArgs = [], isCli = false, options = {}) => {
  const parsed = parseCliArgs(rawArgs, VERIFY_ARGS);
  const isJson = Boolean(parsed.flags.json) || options.json === true;
  const shouldPrint = options.print !== false;
  const wantsHelp = Boolean(parsed.flags.help) || parsed.positionals[0] === 'help';
  if (wantsHelp) {
    if (shouldPrint) process.stdout.write(isJson ? `${JSON.stringify({ help: true, success: true })}\n` : VERIFY_HELP);
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const argError = describeArgErrors(parsed, 'verify', { strayHint: VERIFY_STRAY_HINT });
  if (argError) {
    const summary = { status: STATUS.FAIL, success: false, error: argError };
    printEarly(summary, isJson, shouldPrint);
    return finish(summary, STATUS.FAIL, { isCli });
  }

  const includeBuild = Boolean(parsed.flags.build) || options.includeBuild === true;
  const allowEmpty = Boolean(parsed.flags.allowEmpty) || options.allowEmpty === true;
  const timeoutMs = parseTimeoutSeconds(parsed.values.timeout) ?? options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const explicitDir = parsed.values.dir || options.targetDir;
  const baseDir = options.cwd || process.cwd();
  const explicitAbsDir = explicitDir ? path.resolve(baseDir, explicitDir) : null;
  // A repo with its own tests/run-tests.mjs (the WordPress plugins) is its own project, whatever package.json sits above it.
  const projectRunner = findProjectRunner(explicitAbsDir ?? baseDir);
  const base = parsed.values.base || options.base || null;
  const wantsChanged = Boolean(parsed.flags.changed || options.changed);
  const hasOwnRunner = projectRunner !== null;
  if (hasOwnRunner) {
    const request = { rawArgs, isJson, shouldPrint, timeoutMs, allowEmpty, includeBuild, explicitDir: explicitAbsDir, wantsAll: Boolean(parsed.flags.all), wantsChanged, base, options };
    const summary = await runHarnessVerify(projectRunner, request);
    return finish(summary, summary.status, { isCli });
  }
  if (parsed.flags.all) {
    const refused = { status: STATUS.FAIL, success: false, error: ALL_NEEDS_RUNNER };
    printEarly(refused, isJson, shouldPrint);
    return finish(refused, STATUS.FAIL, { isCli });
  }
  const cwd = findProjectRoot(explicitAbsDir ?? baseDir);
  const workspace = options.inWorkspace || explicitDir ? null : workspaceAt(cwd);
  if (workspace) {
    const flags = { changed: wantsChanged, base, allPackages: Boolean(parsed.flags.allPackages || options.allPackages) };
    const packageOptions = { print: false, json: true, inWorkspace: true, timeoutMs, allowEmpty, includeBuild };
    const runInPackage = (pkg, args) => runProjectVerify(args, false, { ...packageOptions, cwd: pkg.dir });
    return emitWorkspace(await verifyWorkspace(workspace, flags, runInPackage), { isJson, isCli, shouldPrint }, formatVerifyLine);
  }
  const scope = resolveAuditScope({ projectRoot: cwd, explicitDir: explicitAbsDir, narrowWorkspaceRoot: true });

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('verifying');
    const summary = {
      status: STATUS.FAIL,
      success: false,
      error: friendlyMsg,
      audit: { score: 0, grade: 'F', violationsCount: 0, criticalCount: 0 },
      typecheck: {
        success: false,
        errorCount: 1,
        executionError: friendlyMsg,
        errors: [{ file: 'package.json', line: 1, column: 1, code: 'MISSING_NODE_MODULES', message: friendlyMsg }]
      },
      tests: {
        success: false,
        total: 0,
        passed: 0,
        failed: 1,
        executionError: friendlyMsg,
        failures: [{ name: 'dependencies', details: [friendlyMsg] }]
      }
    };
    printEarly(summary, isJson, shouldPrint);
    return finish(summary, STATUS.FAIL, { isCli });
  }

  const isScopeRefused = !scope.ok;
  if (isScopeRefused) {
    const summary = { status: STATUS.FAIL, success: false, error: scope.message, scope: { reason: scope.reason, candidates: scope.candidates } };
    printEarly(summary, isJson, shouldPrint);
    return finish(summary, STATUS.FAIL, { isCli });
  }

  // --changed: null when not asked for, or when git cannot list changes (then everything runs).
  const listing = wantsChanged ? resolveVerifyChanges(cwd, base) : null;
  const changes = listing?.ok ? listing : null;
  const isText = !isJson && shouldPrint;
  if (isText) process.stdout.write(verifyBanner());
  const progress = createProgress(isText);

  const audit = runAuditStep({ cwd, scope, changes, base, rawArgs, config: options.config, progress });

  // Only the audit is scoped; typecheck, tests and build run project-wide, so each line names its command.
  progress.start('TypeScript');
  const typecheck = typecheckSection(await runTypecheckAudit([], false, { print: false, cwd, timeoutMs, inWorkspace: true }));
  progress.finish(stepLine(typecheck.status, 'TypeScript', formatTypecheckStep(typecheck), typecheck.status === SKIPPED ? '' : typecheck.command) + sharedRunNote(typecheck));

  progress.start('Test Suite');
  const tests = testsSection(await runTestAudit(testArgsFor(changes, base), false, { print: false, cwd, timeoutMs, allowEmpty, inWorkspace: true }));
  progress.finish(stepLine(testStepIcon(tests), 'Test Suite', formatTestStep(tests), tests.command) + sharedRunNote(tests));

  let build = null;
  if (includeBuild) {
    progress.start('Production Build');
    build = buildSection(await runBuildAudit(['--json'], false, { print: false, cwd, timeoutMs }));
    progress.finish(stepLine(build.status, 'Production Build', formatBuildStep(build), build.command) + sharedRunNote(build));
  }

  const stepStatuses = { audit: audit.status, typecheck: typecheck.status, tests: tests.status, build: build?.status };
  const status = combineStepStatuses(stepStatuses);
  const architecturalWarning = architecturalWarningFor(stepStatuses);
  const summary = {
    status,
    success: status === STATUS.PASS,
    scope: changes ? { dir: scope.relDir, source: 'changed', base: changes.base, files: changes.files, typecheck: 'whole project' } : { dir: scope.relDir, source: scope.source, ...(scope.excluded ? { excluded: scope.excluded } : {}), ...(listing && !listing.ok ? { changedError: listing.error } : {}) },
    architecturalWarning,
    audit: audit.section,
    typecheck,
    tests,
    ...(build ? { build } : {})
  };

  const shouldPrintJson = isJson && shouldPrint;
  if (shouldPrintJson) process.stdout.write(formatAgentJson(summary) + '\n');
  if (isText) process.stdout.write(formatVerdict(status, architecturalWarning, { testsRanNothing: isEmptyAllowed(tests) }));
  return finish(summary, status, { isCli });
};
