import path from 'node:path';
import { loadProjectConfig } from './config/index.js';
import { runAudit as executeAstAudit } from './audit.js';
import { runBuildAudit } from './build.js';
import { findProjectRoot } from './build/detector.js';
import { resolveAuditScope } from './audit-scope.js';
import { computeGateVerdict } from './audit/gate-verdict.js';
import { ANSI } from './theme.js';
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
  VERIFY_HELP, stepLine, formatTypecheckStep, formatTestStep, testStepIcon, formatBuildStep, createProgress, formatVerdict
} from './verify-report.js';

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
  booleans: { '--json': 'json', '--build': 'build', '--allow-empty': 'allowEmpty', '--help': 'help', '-h': 'help' },
  values: { '--dir': 'dir', '--timeout': 'timeout', '--profile': 'profile' }
};

// verify takes no positional arguments; `chemx verify src` must not silently verify everything.
const describeStrayPositionals = (parsed) => {
  const hasStray = parsed.positionals.length > 0;
  return hasStray ? `chemx verify: unexpected argument(s) ${parsed.positionals.join(' ')}; use --dir=<path> to pick a directory.` : null;
};

const finish = (summary, status, { isCli }) => {
  if (isCli) process.exit(toExitCode(status));
  return summary;
};

const printEarly = (summary, isJson, shouldPrint) => {
  if (!shouldPrint) return;
  const text = isJson ? JSON.stringify(summary, null, 2) : `\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${summary.error}${ANSI.RESET}\n`;
  process.stdout.write(text + '\n');
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

  const argError = describeArgErrors(parsed, 'verify') || describeStrayPositionals(parsed);
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
  const cwd = findProjectRoot(explicitAbsDir ?? baseDir);
  const scope = resolveAuditScope({ projectRoot: cwd, explicitDir: explicitAbsDir });

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

  if (!scope.ok) {
    const summary = { status: STATUS.FAIL, success: false, error: scope.message, scope: { reason: scope.reason, candidates: scope.candidates } };
    printEarly(summary, isJson, shouldPrint);
    return finish(summary, STATUS.FAIL, { isCli });
  }

  const isText = !isJson && shouldPrint;
  if (isText) process.stdout.write(`\n  ${ANSI.BOLD}${ANSI.CYAN}⚡ Chemical X: Token-Conserving Project Verification${ANSI.RESET}\n\n`);
  const progress = createProgress(isText);

  progress.start('AST Architecture');
  const projectConfig = options.config || loadProjectConfig(cwd, rawArgs);
  const auditReport = executeAstAudit(scope.dir, { cwd, config: projectConfig });
  const gate = computeGateVerdict({ projectRoot: cwd, scope: scope.relDir, violations: auditReport.violations });
  const auditStatus = gate.isPassing ? STATUS.PASS : STATUS.FAIL;
  const auditText = `${auditReport.health.grade} (${auditReport.health.score}/100, ${auditReport.totalViolations} violations)`;
  progress.finish(stepLine(auditStatus, 'AST Architecture', auditText, `${scope.relDir}/, ${gate.basis} gate`));

  // Only the audit is scoped; typecheck, tests and build run project-wide, so each line names its command.
  progress.start('TypeScript');
  const typecheck = typecheckSection(await runTypecheckAudit([], false, { print: false, cwd, timeoutMs }));
  progress.finish(stepLine(typecheck.status, 'TypeScript', formatTypecheckStep(typecheck), typecheck.status === SKIPPED ? '' : typecheck.command));

  progress.start('Test Suite');
  const tests = testsSection(await runTestAudit([], false, { print: false, cwd, timeoutMs, allowEmpty }));
  progress.finish(stepLine(testStepIcon(tests), 'Test Suite', formatTestStep(tests), tests.command));

  let build = null;
  if (includeBuild) {
    progress.start('Production Build');
    build = buildSection(await runBuildAudit(['--json'], false, { print: false, cwd, timeoutMs }));
    progress.finish(stepLine(build.status, 'Production Build', formatBuildStep(build), build.command));
  }

  const stepStatuses = { audit: auditStatus, typecheck: typecheck.status, tests: tests.status, build: build?.status };
  const status = combineStepStatuses(stepStatuses);
  const architecturalWarning = architecturalWarningFor(stepStatuses);
  const summary = {
    status,
    success: status === STATUS.PASS,
    scope: { dir: scope.relDir, source: scope.source },
    architecturalWarning,
    audit: {
      status: auditStatus,
      score: auditReport.health.score,
      grade: auditReport.health.grade,
      violationsCount: auditReport.totalViolations,
      criticalCount: auditReport.violations.filter((v) => v.severity === 'CRITICAL').length,
      passing: gate.isPassing,
      basis: gate.basis,
      regressions: gate.regressions.slice(0, 10),
      note: gate.note
    },
    typecheck,
    tests,
    ...(build ? { build } : {})
  };

  if (isJson && shouldPrint) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (isText) process.stdout.write(formatVerdict(status, architecturalWarning));
  return finish(summary, status, { isCli });
};
