// `chemx verify` in a repo with its own tests/run-tests.mjs harness runner (task #6770): the WordPress
// plugins, which have no package.json. There is no node_modules to demand and nothing to typecheck, so
// the gate is php -l over the PHP files, the repo's own runner, and the audit as it is everywhere else.
// The exit code is the worst of the three.
import { STATUS } from './result-status.js';
import { resolveAuditScope } from './audit-scope.js';
import { runBuildAudit } from './build.js';
import { runTestAudit } from './test-audit.js';
import { sharedRunNote } from './job-line-text.js';
import { formatAgentJson } from './agent-json.js';
import { lintPhp } from './verify-php-lint.js';
import { runAuditStep } from './verify-audit-step.js';
import { resolveVerifyChanges } from './verify-changed.js';
import { testsSection, buildSection, combineStepStatuses, architecturalWarningFor } from './verify-steps.js';
import {
  stepLine, formatTestStep, testStepIcon, formatBuildStep, createProgress, formatVerdict, isEmptyAllowed,
  formatPhpLintStep, formatPhpLintErrors, lintScopeNote, printEarly, verifyBanner
} from './verify-report.js';

const scopeField = (scope, changes, listing, project) => ({
  dir: scope.relDir,
  source: changes ? 'changed' : scope.source,
  runner: project.file,
  ...(changes ? { base: changes.base, files: changes.files } : {}),
  ...(listing && !listing.ok ? { changedError: listing.error } : {})
});

// request: { rawArgs, isJson, shouldPrint, timeoutMs, allowEmpty, includeBuild, explicitDir, wantsAll, wantsChanged, base, options }.
// Prints as it goes and returns the summary; the caller turns its status into the exit code.
export const runHarnessVerify = async (project, request) => {
  const { rawArgs, isJson, shouldPrint, timeoutMs, allowEmpty, includeBuild, explicitDir, wantsAll, wantsChanged, base, options } = request;
  const cwd = project.root;
  const scope = resolveAuditScope({ projectRoot: cwd, explicitDir });
  const isScopeRefused = !scope.ok;
  if (isScopeRefused) {
    const refused = { status: STATUS.FAIL, success: false, error: scope.message, scope: { reason: scope.reason, candidates: scope.candidates } };
    printEarly(refused, isJson, shouldPrint);
    return refused;
  }

  const listing = wantsChanged ? resolveVerifyChanges(cwd, base) : null;
  const changes = listing?.ok ? listing : null;
  const isText = !isJson && shouldPrint;
  if (isText) process.stdout.write(verifyBanner());
  const progress = createProgress(isText);

  progress.start('PHP syntax');
  const phpLint = lintPhp(cwd, { all: wantsAll, base, php: options.phpBinary });
  progress.finish(stepLine(phpLint.status, 'PHP syntax', formatPhpLintStep(phpLint), lintScopeNote(phpLint)) + formatPhpLintErrors(phpLint));

  // The runner is the whole repo runner: a harness suite shares one database, so it is never narrowed to a change.
  progress.start('Test Suite');
  const tests = testsSection(await runTestAudit([], false, { print: false, cwd, timeoutMs, allowEmpty, inWorkspace: true, env: options.env, onWait: options.onWait }));
  progress.finish(stepLine(testStepIcon(tests), 'Test Suite', formatTestStep(tests), tests.command) + sharedRunNote(tests));

  const audit = runAuditStep({ cwd, scope, changes, base, rawArgs, config: options.config, progress });

  let build = null;
  if (includeBuild) {
    progress.start('Production Build');
    build = buildSection(await runBuildAudit(['--json'], false, { print: false, cwd, timeoutMs }));
    progress.finish(stepLine(build.status, 'Production Build', formatBuildStep(build), build.command) + sharedRunNote(build));
  }

  const stepStatuses = { phpLint: phpLint.status, tests: tests.status, audit: audit.status, build: build?.status };
  const status = combineStepStatuses(stepStatuses);
  const architecturalWarning = architecturalWarningFor(stepStatuses);
  const summary = {
    status,
    success: status === STATUS.PASS,
    scope: scopeField(scope, changes, listing, project),
    architecturalWarning,
    phpLint,
    tests,
    audit: audit.section,
    ...(build ? { build } : {})
  };

  const shouldPrintJson = isJson && shouldPrint;
  if (shouldPrintJson) process.stdout.write(formatAgentJson(summary) + '\n');
  if (isText) process.stdout.write(formatVerdict(status, architecturalWarning, { testsRanNothing: isEmptyAllowed(tests) }));
  return summary;
};
