import fs from 'node:fs';
import path from 'node:path';
import { executeBuild } from './build/executor.js';
import { loadProjectConfig } from './config/index.js';
import { runAudit as executeAstAudit } from './audit.js';
import { runBuildAudit } from './build.js';
import { findProjectRoot } from './build/detector.js';
import { ANSI } from './theme.js';
import {
  parseCommandFromArgs,
  detectTypecheckCommand,
  detectTestCommand,
  parseTypecheckOutput,
  parseTestOutput,
  checkNodeModules
} from './verify-helpers.js';

export {
  parseCommandFromArgs,
  detectTypecheckCommand,
  detectTestCommand,
  parseTypecheckOutput,
  parseTestOutput
} from './verify-helpers.js';
export { runLintAudit } from './verify-lint.js';

export const runTypecheckAudit = async (rawArgs = [], isCli = false, options = {}) => {
  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help')) {
    const isJson = rawArgs.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx typecheck [options] [-- <command>]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --json                   Output structured diagnostics as JSON`,
        `  --raw                    Do not capture or format output`,
        `  -h, --help               Show this help message`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const isJson = rawArgs.includes('--json') || options.json === true;
  const isRaw = rawArgs.includes('--raw') || options.raw === true;
  const customCmd = parseCommandFromArgs(rawArgs) || options.command;
  const cwd = findProjectRoot(options.cwd || process.cwd());

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('typechecking');
    const report = {
      success: false,
      exitCode: 1,
      command: customCmd || 'typecheck',
      durationMs: 0,
      errorCount: 1,
      executionError: friendlyMsg,
      errors: [
        {
          file: 'package.json',
          line: 1,
          column: 1,
          code: 'MISSING_NODE_MODULES',
          message: friendlyMsg
        }
      ]
    };
    if (isJson) {
      if (options.print !== false) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      }
      if (isCli) process.exit(1);
      return report;
    }
    if (options.print !== false) {
      process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${friendlyMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit(1);
    return report;
  }

  const command = detectTypecheckCommand(customCmd, cwd);
  const execution = await executeBuild(command, cwd, { raw: isRaw });
  const errors = parseTypecheckOutput(execution.stdout, execution.stderr);
  const isSuccess = execution.exitCode === 0 && errors.length === 0;

  let executionError = null;
  if (execution.exitCode !== 0 && errors.length === 0) {
    const rawLines = `${execution.stderr}\n${execution.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
    executionError = rawLines.find((l) => /error|not found|cannot find/i.test(l)) || rawLines[0] || `Command exited with code ${execution.exitCode}`;
  }

  const report = {
    success: isSuccess,
    exitCode: execution.exitCode,
    command,
    durationMs: execution.durationMs,
    errorCount: errors.length,
    executionError,
    errors
  };

  if (isJson) {
    if (options.print !== false) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    if (isCli) process.exit(report.success ? 0 : 1);
    return report;
  }

  if (options.print !== false) {
    if (report.success) {
      process.stdout.write(`  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}TypeScript typecheck clean${ANSI.RESET} ${ANSI.DIM}(${report.durationMs}ms)${ANSI.RESET}\n`);
    } else {
      if (report.executionError) {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Execution Error:${ANSI.RESET} ${report.executionError}\n\n`);
      } else {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}TypeScript Errors (${report.errorCount} found)${ANSI.RESET}\n`);
        for (const err of report.errors.slice(0, 10)) {
          process.stdout.write(`    ${ANSI.CYAN}${err.file}:${err.line}:${err.column}${ANSI.RESET} [${err.code}] ${err.message}\n`);
        }
        if (report.errors.length > 10) {
          process.stdout.write(`    ${ANSI.DIM}...and ${report.errors.length - 10} more diagnostics${ANSI.RESET}\n`);
        }
        process.stdout.write('\n');
      }
    }
  }

  if (isCli) process.exit(report.success ? 0 : 1);
  return report;
};

export const runTestAudit = async (rawArgs = [], isCli = false, options = {}) => {
  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help')) {
    const isJson = rawArgs.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx test [options] [-- <command>]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --json                   Output test summary as minified JSON`,
        `  --raw                    Do not suppress passing test output`,
        `  -h, --help               Show this help message`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const isJson = rawArgs.includes('--json') || options.json === true;
  const isRaw = rawArgs.includes('--raw') || options.raw === true;
  const customCmd = parseCommandFromArgs(rawArgs) || options.command;
  const cwd = findProjectRoot(options.cwd || process.cwd());

  const targetFlag = (rawArgs.find((a) => a.startsWith('--target=')) || '').replace(/^--target=/, '');
  const filterFlag = (rawArgs.find((a) => a.startsWith('--filter=') || a.startsWith('-t=')) || '').replace(/^--(filter|t)=/, '');
  const positionalTarget = rawArgs.find((a) => !a.startsWith('-') && !['test', 'tests', 'check:test'].includes(a) && (a.endsWith('.js') || a.endsWith('.ts') || a.includes('/')));
  const target = options.target || targetFlag || positionalTarget || null;
  const filter = options.filter || filterFlag || null;

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('testing');
    const report = {
      success: false,
      exitCode: 1,
      command: customCmd || 'test',
      durationMs: 0,
      totalTests: 0,
      passed: 0,
      failed: 1,
      skipped: 0,
      executionError: friendlyMsg,
      failures: [{ name: 'dependencies', details: [friendlyMsg] }]
    };
    if (isJson) {
      if (options.print !== false) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      }
      if (isCli) process.exit(1);
      return report;
    }
    if (options.print !== false) {
      process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${friendlyMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit(1);
    return report;
  }

  const command = detectTestCommand(customCmd, cwd, { target, filter });
  const execution = await executeBuild(command, cwd, { raw: isRaw });
  const parsed = parseTestOutput(execution.stdout, execution.stderr, execution.exitCode);

  const hasFailedExitCode = execution.exitCode !== 0;
  const hasNoTestFailures = parsed.failed === 0 && parsed.failures.length === 0;
  const isExecutionFault = hasFailedExitCode && hasNoTestFailures;

  let executionError = null;
  if (isExecutionFault) {
    const rawLines = `${execution.stderr}\n${execution.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
    executionError = rawLines.find((l) => /error|not found|failed/i.test(l)) || rawLines[0] || `Command exited with code ${execution.exitCode}`;
  }

  const report = {
    success: parsed.success,
    exitCode: execution.exitCode,
    command,
    durationMs: execution.durationMs,
    totalTests: parsed.totalTests,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    executionError,
    failures: parsed.failures
  };

  if (isJson) {
    if (options.print !== false) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    if (isCli) process.exit(report.success ? 0 : 1);
    return report;
  }

  if (options.print !== false) {
    if (report.success) {
      process.stdout.write(`  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}All tests passed${ANSI.RESET} ${ANSI.DIM}(${report.passed} tests in ${report.durationMs}ms)${ANSI.RESET}\n`);
    } else {
      if (report.executionError) {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test Execution Error:${ANSI.RESET} ${report.executionError}\n\n`);
      } else {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test Failures (${report.failed} failed out of ${report.totalTests})${ANSI.RESET}\n`);
        for (const fail of report.failures.slice(0, 5)) {
          process.stdout.write(`    ${ANSI.RED}✖ ${fail.name}${ANSI.RESET}\n`);
          for (const line of (fail.details || []).slice(0, 3)) {
            process.stdout.write(`      ${ANSI.DIM}${line}${ANSI.RESET}\n`);
          }
        }
        process.stdout.write('\n');
      }
    }
  }

  if (isCli) process.exit(report.success ? 0 : 1);
  return report;
};

const resolveDefaultTargetDir = (cwd) => {
  if (fs.existsSync(path.join(cwd, 'src'))) return path.join(cwd, 'src');
  if (fs.existsSync(path.join(cwd, 'blueprints'))) return path.join(cwd, 'blueprints');
  return cwd;
};

export const runProjectVerify = async (rawArgs = [], isCli = false, options = {}) => {
  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help')) {
    const isJson = rawArgs.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx verify [options]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --dir=<path>             Target directory to verify (default: src/ or blueprints/)`,
        `  --build                  Include production build audit step`,
        `  --json                   Output summary status card as JSON`,
        `  -h, --help               Show this help message`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const isJson = rawArgs.includes('--json') || options.json === true;
  const includeBuild = rawArgs.includes('--build') || options.includeBuild === true;
  const dirFlag = rawArgs.find((a) => a.startsWith('--dir='));
  const explicitDir = dirFlag ? dirFlag.split('=')[1] : options.targetDir;
  const cwd = findProjectRoot(explicitDir || options.cwd || process.cwd());
  const targetDir = explicitDir || resolveDefaultTargetDir(cwd);

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('verifying');
    const summary = {
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
    if (isJson) {
      if (options.print !== false) {
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      }
      if (isCli) process.exit(1);
      return summary;
    }
    if (options.print !== false) {
      process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${friendlyMsg}${ANSI.RESET}\n\n`);
    }
    if (isCli) process.exit(1);
    return summary;
  }

  if (!isJson && options.print !== false) {
    process.stdout.write(`\n  ${ANSI.BOLD}${ANSI.CYAN}⚡ Chemical X: Token-Conserving Project Verification${ANSI.RESET}\n\n`);
  }

  const projectConfig = options.config || loadProjectConfig(cwd, rawArgs);
  const auditReport = executeAstAudit(targetDir, { cwd, config: projectConfig });
  const isAuditPassing = auditReport.violations.filter((v) => v.severity === 'CRITICAL').length === 0;

  const typeReport = await runTypecheckAudit([], false, { print: false, cwd });
  const testReport = await runTestAudit([], false, { print: false, cwd });

  let buildReport = null;
  if (includeBuild) {
    buildReport = await runBuildAudit(['--json'], false, { print: false, cwd });
  }

  const hasBuildOrTestFailure = !typeReport.success || !testReport.success || (buildReport && !buildReport.isPassing);
  const isArchitecturePassingOnly = isAuditPassing && hasBuildOrTestFailure;
  const isAllPassed = isAuditPassing && typeReport.success && testReport.success && (!buildReport || buildReport.isPassing);

  const summary = {
    success: isAllPassed,
    architecturalWarning: isArchitecturePassingOnly
      ? 'AST compliance does not guarantee functional correctness. Fix typecheck or test errors before deployment.'
      : null,
    audit: {
      score: auditReport.health.score,
      grade: auditReport.health.grade,
      violationsCount: auditReport.totalViolations,
      criticalCount: auditReport.violations.filter((v) => v.severity === 'CRITICAL').length
    },
    typecheck: {
      success: typeReport.success,
      errorCount: typeReport.errorCount,
      executionError: typeReport.executionError || null,
      errors: typeReport.errors.slice(0, 5)
    },
    tests: {
      success: testReport.success,
      total: testReport.totalTests,
      passed: testReport.passed,
      failed: testReport.failed,
      executionError: testReport.executionError || null,
      failures: testReport.failures.slice(0, 3)
    }
  };

  if (buildReport) {
    summary.build = {
      success: buildReport.isPassing,
      totalDiagnostics: buildReport.totalDiagnostics
    };
  }

  if (isJson) {
    if (options.print !== false) {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    }
    if (isCli) process.exit(isAllPassed ? 0 : 1);
    return summary;
  }

  if (options.print !== false) {
    const auditIcon = isAuditPassing ? `${ANSI.LIME}✔${ANSI.RESET}` : `${ANSI.RED}✖${ANSI.RESET}`;
    const typeIcon = typeReport.success ? `${ANSI.LIME}✔${ANSI.RESET}` : `${ANSI.RED}✖${ANSI.RESET}`;
    const testIcon = testReport.success ? `${ANSI.LIME}✔${ANSI.RESET}` : `${ANSI.RED}✖${ANSI.RESET}`;

    const formatTypeStatus = () => {
      if (typeReport.success) return 'Clean (0 errors)';
      if (typeReport.executionError) return `Command Failed (${typeReport.executionError})`;
      return `${typeReport.errorCount} error(s)`;
    };
    const formatTestStatus = () => {
      if (testReport.success) return `Passed (${testReport.passed}/${testReport.totalTests})`;
      if (testReport.executionError) return `Command Failed (${testReport.executionError})`;
      return `${testReport.failed} failed`;
    };

    const typeStatus = formatTypeStatus();
    const testStatus = formatTestStatus();

    process.stdout.write(`  ${auditIcon} AST Architecture:  ${auditReport.health.grade} (${auditReport.health.score}/100, ${auditReport.totalViolations} violations)\n`);
    process.stdout.write(`  ${typeIcon} TypeScript:        ${typeStatus}\n`);
    process.stdout.write(`  ${testIcon} Test Suite:        ${testStatus}\n`);
    if (buildReport) {
      const buildIcon = buildReport.isPassing ? `${ANSI.LIME}✔${ANSI.RESET}` : `${ANSI.RED}✖${ANSI.RESET}`;
      process.stdout.write(`  ${buildIcon} Production Build:  ${buildReport.isPassing ? 'Success' : 'Failed'}\n`);
    }

    process.stdout.write('\n');
    if (isAllPassed) {
      process.stdout.write(`  ${ANSI.LIME}${ANSI.BOLD}All verification checks passed with zero context burn!${ANSI.RESET}\n\n`);
    } else {
      process.stdout.write(`  ${ANSI.RED}${ANSI.BOLD}Verification failed. Actionable issues cataloged above.${ANSI.RESET}\n`);
      if (isArchitecturePassingOnly) {
        process.stdout.write(`  ${ANSI.YELLOW}⚠ Notice: Architectural compliance (${auditReport.health.grade}) does not guarantee functional correctness. Code cannot be considered production ready while typecheck or test errors persist.${ANSI.RESET}\n`);
      }
      process.stdout.write('\n');
    }
  }

  if (isCli) process.exit(isAllPassed ? 0 : 1);
  return summary;
};
