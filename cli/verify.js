import fs from 'node:fs';
import path from 'node:path';
import { executeBuild } from './build/executor.js';
import { matchTypeScriptError } from './build/parser-matchers.js';
import { runAudit as executeAstAudit } from './audit.js';
import { runBuildAudit } from './build.js';
import { resolvePackageManager, loadLocalPackageJson, findProjectRoot } from './build/detector.js';
import { ANSI } from './theme.js';

const parseCommandFromArgs = (args = []) => {
  const dashDashIndex = args.indexOf('--');
  if (dashDashIndex !== -1) {
    const afterDash = args.slice(dashDashIndex + 1).join(' ').trim();
    if (afterDash.length > 0) return afterDash;
  }
  return null;
};

export const detectTypecheckCommand = (customCmd, cwd = process.cwd()) => {
  if (customCmd && customCmd.trim().length > 0) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  if (scripts.typecheck) return `${pm} run typecheck`;
  if (scripts['type-check']) return `${pm} run type-check`;
  if (scripts['check-types']) return `${pm} run check-types`;
  if (scripts.tsc) return `${pm} run tsc`;

  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
    return 'npx tsc --noEmit';
  }

  return `${pm} run typecheck`;
};

export const detectTestCommand = (customCmd, cwd = process.cwd()) => {
  if (customCmd && customCmd.trim().length > 0) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  const isLegitTest = scripts.test && !scripts.test.includes('no test specified');
  if (isLegitTest) return pm === 'yarn' ? 'yarn test' : `${pm} run test`;

  if (fs.existsSync(path.join(cwd, 'vitest.config.ts')) || fs.existsSync(path.join(cwd, 'vitest.config.js'))) {
    return 'npx vitest run';
  }

  return pm === 'yarn' ? 'yarn test' : `${pm} run test`;
};

export const parseTypecheckOutput = (stdout = '', stderr = '') => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  const errors = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = matchTypeScriptError(trimmed);
    if (match) {
      const key = `${match.file}:${match.line}:${match.column}:${match.code}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(match);
      }
    }
  }

  return errors;
};

const stripAnsi = (str = '') => String(str).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

export const parseTestOutput = (stdout = '', stderr = '', exitCode = 0) => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);

  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let checkmarkPasses = 0;
  let crossmarkFails = 0;

  for (const line of lines) {
    const clean = stripAnsi(line).trim();
    if (!clean) continue;

    if (clean.startsWith('✔')) checkmarkPasses++;
    if (clean.startsWith('✖') || clean.startsWith('FAIL ')) crossmarkFails++;

    const nodeTests = clean.match(/(?:ℹ\s*)?tests\s+(\d+)/);
    if (nodeTests) totalTests = parseInt(nodeTests[1], 10);

    const nodePass = clean.match(/(?:ℹ\s*)?pass\s+(\d+)/);
    if (nodePass) passed = parseInt(nodePass[1], 10);

    const nodeFail = clean.match(/(?:ℹ\s*)?fail\s+(\d+)/);
    if (nodeFail) failed = parseInt(nodeFail[1], 10);

    const nodeSkip = clean.match(/(?:ℹ\s*)?(?:skipped|todo)\s+(\d+)/);
    if (nodeSkip) skipped += parseInt(nodeSkip[1], 10);

    const vitestMatch = clean.match(/Tests\s+(?:(\d+)\s+failed)?(?:,\s*)?(?:(\d+)\s+passed)?\s*\((\d+)\)/);
    if (vitestMatch) {
      if (vitestMatch[1]) failed = parseInt(vitestMatch[1], 10);
      if (vitestMatch[2]) passed = parseInt(vitestMatch[2], 10);
      if (vitestMatch[3]) totalTests = parseInt(vitestMatch[3], 10);
    }
  }

  if (passed === 0 && checkmarkPasses > 0) passed = checkmarkPasses;
  if (failed === 0 && crossmarkFails > 0) failed = crossmarkFails;
  if (totalTests === 0) totalTests = passed + failed;

  const failures = [];
  if (exitCode !== 0 || failed > 0) {
    let currentFailure = null;

    for (const line of lines) {
      const isFailHeader = line.includes('✖') || line.startsWith('FAIL ') || /^\s*not ok\b/.test(line);
      if (isFailHeader) {
        if (currentFailure) failures.push(currentFailure);
        currentFailure = {
          name: line.replace(/[✖]/g, '').trim(),
          details: []
        };
      } else if (currentFailure) {
        const isCleanLine = !line.includes('✔') && !line.includes('ℹ') && !line.includes('ExperimentalWarning');
        if (isCleanLine && line.trim().length > 0) {
          currentFailure.details.push(line.trim());
          if (currentFailure.details.length >= 6) {
            failures.push(currentFailure);
            currentFailure = null;
          }
        }
      }
    }

    if (currentFailure) failures.push(currentFailure);

    if (failures.length === 0 && exitCode !== 0) {
      const errorLines = lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.includes('✔') && !l.includes('ExperimentalWarning'))
        .slice(-10);
      failures.push({
        name: 'Test process exit error',
        details: errorLines
      });
    }
  }

  if (failed === 0 && exitCode !== 0) {
    failed = Math.max(1, failures.length);
  }

  return {
    success: exitCode === 0 && failed === 0,
    exitCode,
    totalTests: totalTests || (passed + failed),
    passed,
    failed,
    skipped,
    failures
  };
};

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

  const command = detectTestCommand(customCmd, cwd);
  const execution = await executeBuild(command, cwd, { raw: isRaw });
  const parsed = parseTestOutput(execution.stdout, execution.stderr, execution.exitCode);

  let executionError = null;
  if (execution.exitCode !== 0 && parsed.failed === 0 && parsed.failures.length === 0) {
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
  const hasSrc = fs.existsSync(path.resolve(cwd, 'src'));
  if (hasSrc) return 'src';
  const hasBlueprints = fs.existsSync(path.resolve(cwd, 'blueprints'));
  if (hasBlueprints) return 'blueprints';
  return '.';
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

  if (!isJson && options.print !== false) {
    process.stdout.write(`\n  ${ANSI.BOLD}${ANSI.CYAN}⚡ Chemical X: Token-Conserving Project Verification${ANSI.RESET}\n\n`);
  }

  // 1. AST Architectural Audit
  const auditReport = executeAstAudit(targetDir, {});
  const isAuditPassing = auditReport.violations.filter((v) => v.severity === 'CRITICAL').length === 0;

  // 2. TypeScript Typecheck
  const typeReport = await runTypecheckAudit([], false, { print: false, cwd });

  // 3. Test Suite
  const testReport = await runTestAudit([], false, { print: false, cwd });

  // 4. Optional Build Audit
  let buildReport = null;
  if (includeBuild) {
    buildReport = await runBuildAudit(['--json'], false, { print: false, cwd });
  }

  const isAllPassed = isAuditPassing && typeReport.success && testReport.success && (!buildReport || buildReport.isPassing);

  const summary = {
    success: isAllPassed,
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

    const typeStatus = typeReport.success
      ? 'Clean (0 errors)'
      : (typeReport.executionError ? `Command Failed (${typeReport.executionError})` : `${typeReport.errorCount} error(s)`);
    const testStatus = testReport.success
      ? `Passed (${testReport.passed}/${testReport.totalTests})`
      : (testReport.executionError ? `Command Failed (${testReport.executionError})` : `${testReport.failed} failed`);

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
      process.stdout.write(`  ${ANSI.RED}${ANSI.BOLD}Verification failed. Actionable issues cataloged above.${ANSI.RESET}\n\n`);
    }
  }

  if (isCli) process.exit(isAllPassed ? 0 : 1);
  return summary;
};
