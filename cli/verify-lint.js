import { executeBuild } from './build/executor.js';
import { findProjectRoot } from './build/detector.js';
import { resolvePackageManager, loadLocalPackageJson } from './build/detector.js';
import { ANSI } from './theme.js';
import { parseCommandFromArgs, stripAnsi, checkNodeModules } from './verify-helpers.js';

export const detectLintCommand = (customCmd, cwd = process.cwd(), isFix = false, targetPath = null) => {
  if (customCmd && customCmd.trim().length > 0) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  const cleanTarget = targetPath ? targetPath.trim() : null;

  if (cleanTarget) {
    return `npx eslint ${isFix ? '--fix ' : ''}${cleanTarget}`;
  }

  if (isFix) {
    if (scripts['lint:fix']) return `${pm} run lint:fix`;
    if (scripts.lint) return `${pm} run lint -- --fix`;
    return 'npx eslint --fix .';
  }

  if (scripts.lint) return `${pm} run lint`;
  return 'npx eslint .';
};

export const parseLintOutput = (stdout = '', stderr = '') => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);

  const errors = [];
  const warnings = [];
  let currentFile = null;
  let fixableCount = 0;

  // Pattern: /path/to/file.ext or file.ext (standalone line with no leading whitespace or : )
  const fileHeaderRegex = /^([^\s].+\.[a-zA-Z0-9]+)$/;
  // Pattern:   156:51  error  message  rule-name
  const issueRegex = /^\s*([0-9]+):([0-9]+)\s+(error|warning)\s+(.+?)\s+([a-zA-Z0-9_/@-]+)\s*$/;
  // Pattern: fixable count
  const fixableRegex = /([0-9]+)\s+(?:errors?|warnings?|problems?).*potentially fixable with the `--fix` option/i;

  for (const rawLine of lines) {
    const clean = stripAnsi(rawLine);
    const trimmed = clean.trim();
    if (!trimmed) continue;

    const fixMatch = clean.match(fixableRegex);
    if (fixMatch) {
      fixableCount = parseInt(fixMatch[1], 10);
      continue;
    }

    const fileMatch = clean.match(fileHeaderRegex);
    if (fileMatch && !clean.includes('✖') && !clean.includes('✔') && !clean.includes('problems')) {
      currentFile = fileMatch[1].trim();
      continue;
    }

    const issueMatch = clean.match(issueRegex);
    if (issueMatch) {
      const issue = {
        file: currentFile || 'unknown',
        line: parseInt(issueMatch[1], 10),
        column: parseInt(issueMatch[2], 10),
        severity: issueMatch[3].toLowerCase(),
        message: issueMatch[4].trim(),
        ruleId: issueMatch[5].trim()
      };

      if (issue.severity === 'error') {
        errors.push(issue);
      } else {
        warnings.push(issue);
      }
    }
  }

  return {
    errors,
    warnings,
    errorCount: errors.length,
    warningCount: warnings.length,
    fixableCount
  };
};

export const runLintAudit = async (rawArgs = [], isCli = false, options = {}) => {
  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help')) {
    const isJson = rawArgs.includes('--json');
    if (isJson) {
      process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    } else {
      process.stdout.write([
        `${ANSI.BOLD}USAGE${ANSI.RESET}`,
        `  chemx lint [path] [options] [-- <command>]`,
        '',
        `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
        `  --fix                    Automatically fix fixable lint and tree-formatting errors`,
        `  --json                   Output structured diagnostics as JSON for AI agents`,
        `  --raw                    Do not capture or format output`,
        `  -h, --help               Show this help message`,
        '',
        `${ANSI.BOLD}EXAMPLES${ANSI.RESET}`,
        `  chemx lint`,
        `  chemx lint --fix`,
        `  chemx lint apps/youmeos/components/blueprints/desktop/u-desktop.vue --fix`,
        ''
      ].join('\n'));
    }
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const isJson = rawArgs.includes('--json') || options.json === true;
  const isRaw = rawArgs.includes('--raw') || options.raw === true;
  const isFix = rawArgs.includes('--fix') || options.fix === true;
  const customCmd = parseCommandFromArgs(rawArgs) || options.command;
  const cwd = findProjectRoot(options.cwd || process.cwd());

  // Extract optional target path argument (first non-flag argument)
  const targetPath = rawArgs.find((arg) => !arg.startsWith('-') && arg !== 'lint' && arg !== 'check:lint' && arg !== 'eslint') || null;

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const friendlyMsg = nmStatus.msg('linting');
    const report = {
      success: false,
      exitCode: 1,
      command: customCmd || 'lint',
      durationMs: 0,
      errorCount: 1,
      warningCount: 0,
      fixableCount: 0,
      executionError: friendlyMsg,
      errors: [
        {
          file: 'package.json',
          line: 1,
          column: 1,
          severity: 'error',
          ruleId: 'MISSING_NODE_MODULES',
          message: friendlyMsg
        }
      ],
      warnings: []
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

  const command = detectLintCommand(customCmd, cwd, isFix, targetPath);
  const execution = await executeBuild(command, cwd, { raw: isRaw });
  const parsed = parseLintOutput(execution.stdout, execution.stderr);

  // If exitCode is non-zero but regex didn't parse items (e.g. fatal syntax error), capture raw error
  let executionError = null;
  if (execution.exitCode !== 0 && parsed.errors.length === 0) {
    const rawLines = `${execution.stderr}\n${execution.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
    executionError = rawLines.find((l) => /error|not found|failed/i.test(l)) || rawLines[0] || `Command exited with code ${execution.exitCode}`;
  }

  const isSuccess = execution.exitCode === 0 && parsed.errors.length === 0;

  const report = {
    success: isSuccess,
    exitCode: execution.exitCode,
    command,
    durationMs: execution.durationMs,
    errorCount: parsed.errorCount,
    warningCount: parsed.warningCount,
    fixableCount: parsed.fixableCount,
    executionError,
    errors: parsed.errors,
    warnings: parsed.warnings
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
      const warnInfo = report.warningCount > 0 ? ` with ${report.warningCount} warning(s)` : '';
      process.stdout.write(`  ${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}Linter passed${warnInfo}${ANSI.RESET} ${ANSI.DIM}(in ${report.durationMs}ms)${ANSI.RESET}\n`);
    } else {
      if (report.executionError) {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Lint Execution Error:${ANSI.RESET} ${report.executionError}\n\n`);
      } else {
        process.stdout.write(`\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Lint Failures (${report.errorCount} error${report.errorCount === 1 ? '' : 's'}${report.warningCount > 0 ? `, ${report.warningCount} warning(s)` : ''})${ANSI.RESET}\n`);
        const displayLimit = 10;
        for (const err of report.errors.slice(0, displayLimit)) {
          process.stdout.write(`    ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${err.file}:${err.line}:${err.column}${ANSI.RESET} ${err.message} ${ANSI.DIM}(${err.ruleId})${ANSI.RESET}\n`);
        }
        if (report.errors.length > displayLimit) {
          process.stdout.write(`    ${ANSI.DIM}...and ${report.errors.length - displayLimit} more error(s)${ANSI.RESET}\n`);
        }
        if (report.fixableCount > 0) {
          process.stdout.write(`\n  ${ANSI.CYAN}💡 ${report.fixableCount} issue(s) potentially fixable with 'chemx lint --fix'${ANSI.RESET}\n`);
        }
        process.stdout.write('\n');
      }
    }
  }

  if (isCli) process.exit(report.success ? 0 : 1);
  return report;
};
