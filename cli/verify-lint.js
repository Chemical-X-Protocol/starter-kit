import path from 'node:path';
import { executeBuild } from './build/executor.js';
import { resolvePackageManager, loadLocalPackageJson } from './build/detector.js';
import { ANSI } from './theme.js';
import { formatAgentJson } from './agent-json.js';
import { parseCommandFromArgs, stripAnsi, checkNodeModules } from './verify-helpers.js';
import { workspaceAt, emitWorkspace, allPackagesOrRefuse } from './workspace-run.js';
import { STATUS } from './result-status.js';
import { resolveLintScope, findEslintConfig, relativeLintTargets, fallbackNote } from './lint-scope.js';
import { lintFailureLine } from './lint-error.js';
import { expandLintTargets, runMicroChecks } from './lint-micro.js';
import { fallbackReport, withMicro, printLintReport } from './lint-report.js';
import { loadProjectConfig } from './config/index.js';

const quotePath = (target) => (/\s/.test(target) ? `"${target}"` : target);

/** targetPath: one path or an array of paths for ESLint (default: the whole project). */
export const detectLintCommand = (customCmd, cwd = process.cwd(), isFix = false, targetPath = null) => {
  const hasCustomCommand = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustomCommand) return customCmd.trim();
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};
  const pm = resolvePackageManager(cwd);

  const targets = [targetPath].flat().filter(Boolean).map((target) => quotePath(target.trim()));

  const hasTargets = targets.length > 0;
  if (hasTargets) {
    return `npx eslint ${isFix ? '--fix ' : ''}${targets.join(' ')}`;
  }

  if (isFix) {
    const hasLintFixScript = Boolean(scripts['lint:fix']);
    if (hasLintFixScript) return `${pm} run lint:fix`;
    const hasLintScriptForFix = Boolean(scripts.lint);
    if (hasLintScriptForFix) return `${pm} run lint -- --fix`;
    return 'npx eslint --fix .';
  }

  const hasLintScript = Boolean(scripts.lint);
  if (hasLintScript) return `${pm} run lint`;
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
    const isFileHeader = Boolean(fileMatch && !clean.includes('✖') && !clean.includes('✔') && !clean.includes('problems'));
    if (isFileHeader) {
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

      const isError = issue.severity === 'error';
      if (isError) {
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

const LINT_WORDS = new Set(['lint', 'check:lint', 'eslint']);

// Every positional word before `--` is a path to lint; the words after `--` are the command to run.
const lintTargetsOf = (rawArgs) => {
  const dashIndex = rawArgs.indexOf('--');
  const own = dashIndex === -1 ? rawArgs : rawArgs.slice(0, dashIndex);
  return own.filter((arg) => !arg.startsWith('-') && !LINT_WORDS.has(arg));
};

const printLintHelp = (isJson) => {
  if (isJson) {
    process.stdout.write(JSON.stringify({ help: true, success: true }) + '\n');
    return;
  }
  process.stdout.write([
    `${ANSI.BOLD}USAGE${ANSI.RESET}`,
    `  chemx lint [path...] [options] [-- <command>]`,
    '',
    `${ANSI.BOLD}WHAT IT RUNS${ANSI.RESET}`,
    `  ESLint (the lint script, or npx eslint), grouped by file. With paths it also prints the micro-check`,
    `  hazards of those paths (what chemx check reports), so one pass answers both; either failing fails it.`,
    `  With no package.json or no ESLint config (flat or legacy) it says so in one line and runs chemx check`,
    `  on the files instead (the named paths, or every source file under the directory).`,
    '',
    `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
    `  --fix                    Automatically fix fixable lint and tree-formatting errors`,
    `  --all-packages           At a monorepo root: lint every workspace package (else refused)`,
    `  --json                   Output structured diagnostics as JSON for AI agents`,
    `  --raw                    Do not capture or format output`,
    `  -h, --help               Show this help message`,
    '',
    `${ANSI.BOLD}EXAMPLES${ANSI.RESET}`,
    `  chemx lint`,
    `  chemx lint --fix`,
    `  chemx lint cli/verify-lint.js cli/lint-scope.js`,
    `  chemx lint apps/youmeos/components/blueprints/desktop/u-desktop.vue --fix`,
    ''
  ].join('\n'));
};

// A project with a config but no node_modules: the friendly "run install" line, not an ESLint crash.
const missingModulesReport = (nmStatus, customCmd) => {
  const friendlyMsg = nmStatus.msg('linting');
  return {
    success: false, exitCode: 1, command: customCmd || 'lint', durationMs: 0, errorCount: 1, warningCount: 0, fixableCount: 0,
    executionError: friendlyMsg,
    errors: [{ file: 'package.json', line: 1, column: 1, severity: 'error', ruleId: 'MISSING_NODE_MODULES', message: friendlyMsg }],
    warnings: []
  };
};

const runEslint = async (command, cwd, isRaw) => {
  const execution = await executeBuild(command, cwd, { raw: isRaw });
  const parsed = parseLintOutput(execution.stdout, execution.stderr);
  // A non-zero exit with nothing parsed is a fatal run (no config, bad config, crash): say why in one line.
  const hasUnparsedFailure = execution.exitCode !== 0 && parsed.errors.length === 0;
  const flatConfig = findEslintConfig(cwd)?.flat ? findEslintConfig(cwd).file : null;
  const executionError = hasUnparsedFailure ? lintFailureLine(execution.stdout, execution.stderr, { flatConfig, exitCode: execution.exitCode }) : null;
  return {
    success: execution.exitCode === 0 && parsed.errors.length === 0,
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
};

export const runLintAudit = async (rawArgs = [], isCli = false, options = {}) => {
  const wantsHelp = rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.includes('help');
  if (wantsHelp) {
    printLintHelp(rawArgs.includes('--json'));
    if (isCli) process.exit(0);
    return { help: true, success: true };
  }

  const isJson = rawArgs.includes('--json') || options.json === true;
  const isRaw = rawArgs.includes('--raw') || options.raw === true;
  const isFix = rawArgs.includes('--fix') || options.fix === true;
  const customCmd = parseCommandFromArgs(rawArgs) || options.command;
  const start = path.resolve(options.cwd || process.cwd());
  const scope = resolveLintScope(start, { customCmd });
  const cwd = scope.root;
  const targets = lintTargetsOf(rawArgs);

  // At a monorepo root with no path: lint every package with --all-packages, else refuse.
  const workspace = options.inWorkspace || customCmd || targets.length > 0 ? null : workspaceAt(cwd);
  if (workspace) {
    const allPackages = rawArgs.includes('--all-packages') || options.allPackages === true;
    const runInPackage = async (pkg) => {
      const report = await runLintAudit(isFix ? ['--fix'] : [], false, { cwd: pkg.dir, print: false, json: true, inWorkspace: true });
      return { status: report.success ? STATUS.PASS : STATUS.FAIL, ...report };
    };
    const output = { isJson, isCli, shouldPrint: options.print !== false };
    const formatOne = (entry) => `  ${entry.status} ${ANSI.DIM}(${entry.errorCount ?? 0} error(s), ${entry.command})${ANSI.RESET}\n`;
    return emitWorkspace(await allPackagesOrRefuse(workspace, 'lint', allPackages, 'pass a path inside a package', runInPackage), output, formatOne);
  }

  const shouldPrint = options.print !== false;
  const finish = (report, micro) => {
    printLintReport(report, micro, { isJson, shouldPrint });
    if (isCli) process.exit(report.success ? 0 : 1);
    return report;
  };

  // Paths are typed relative to where the caller stands, which may be below the root ESLint runs in.
  const expanded = targets.length > 0 ? expandLintTargets(targets, start) : null;
  if (scope.fallback) {
    const files = (expanded ?? expandLintTargets(['.'], cwd)).files;
    const micro = runMicroChecks(files, { config: loadProjectConfig(cwd) });
    const note = fallbackNote(cwd, micro.checked, scope.fallback);
    return finish(withMicro(fallbackReport({ fallback: scope.fallback, note }), micro, expanded ?? {}), micro);
  }

  const nmStatus = checkNodeModules(cwd);
  if (nmStatus) {
    const report = missingModulesReport(nmStatus, customCmd);
    if (shouldPrint) process.stdout.write(isJson ? `${formatAgentJson(report)}\n` : `\n  ${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}${report.executionError}${ANSI.RESET}\n\n`);
    if (isCli) process.exit(1);
    return report;
  }

  const eslintTargets = expanded ? relativeLintTargets(targets, start, cwd) : null;
  const report = await runEslint(detectLintCommand(customCmd, cwd, isFix, eslintTargets), cwd, isRaw);
  if (!expanded) return finish(report, null);
  const micro = runMicroChecks(expanded.files, { config: loadProjectConfig(cwd) });
  return finish(withMicro(report, micro, expanded), micro);
};
